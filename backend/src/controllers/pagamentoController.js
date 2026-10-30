const db = require("../../db");
const { getConfig } = require("../models/ConfigMercadoPago");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { validarAssinaturaWebhook } = require("../utils/mpSignature");
const { liberarUsuario } = require("./mikrotikAPIController");
const { gerarAcessoTemporario } = require("./authTempController");
const { obterSenhaRadius } = require("../utils/radiusPassword");
const { bloqueiaPagamentoAlheio, MSG_PAGAMENTO_ALHEIO } = require("../utils/leadUtils");
const { extrairCpfPagador, cpfCompativel, PAGADOR_DESCONHECIDO } = require("../utils/pagadorCpf");
const { baseUrlPublica } = require("../utils/baseUrl");
const { validarCPF } = require("../utils/cpf");
const { montarGatewayInfo } = require("../gateways/gatewayLiberacao");
const { tratarSessaoAtiva } = require("../utils/sessaoAtiva");
const { resolverCupom, registrarUsoCupom, MSG_INVALIDO: MSG_CUPOM_INVALIDO } = require("../utils/cupons");
const { vincularPagamento: vincularIndicacao } = require("../services/indicacoes");

// Resolve empresa_id a partir do plano (para endpoints públicos)
async function resolveEmpresaId(planoId) {
  const [[plano]] = await db.query("SELECT empresa_id FROM planos WHERE id = ?", [planoId]);
  return plano?.empresa_id || null;
}

// Valida um portal_id vindo do CLIENTE contra a empresa do plano. Endpoint
// publico: sem esta checagem, um cliente pode apontar pro portal de OUTRA
// empresa (burlar trial desligado, template WhatsApp alheio, termo LGPD errado).
// Retorna o id validado ou null (caller cai no fallback por mikrotik).
async function validarPortalDaEmpresa(portalIdInput, empresaId) {
  const id = parseInt(portalIdInput, 10);
  if (!id || !empresaId) return null;
  try {
    const [[row]] = await db.query(
      "SELECT id FROM portais WHERE id = ? AND empresa_id = ? LIMIT 1",
      [id, empresaId]
    );
    return row?.id || null;
  } catch (e) {
    return null;
  }
}

// Resolve portal_id a partir do mikrotik_id. A relacao e mikrotiks.portal_id -> portais.id.
async function resolvePortalIdByMikrotik(mikrotikId, empresaId) {
  if (!mikrotikId) return null;
  try {
    const params = [mikrotikId];
    let sql = "SELECT portal_id FROM mikrotiks WHERE id = ?";
    if (empresaId) {
      sql += " AND empresa_id = ?";
      params.push(empresaId);
    }
    sql += " LIMIT 1";
    const [[row]] = await db.query(sql, params);
    return row?.portal_id || null;
  } catch (e) {
    return null;
  }
}

exports.gerarPagamento = async (req, res) => {
  const { plano_id, mac, ip, cpf, cliente_id, portal_id: portalIdInput, cupom } = req.body;
  console.log("[gerarPagamento PIX] body:", { plano_id, cliente_id, portal_id: portalIdInput });

  try {
    const [planos] = await db.query("SELECT * FROM planos WHERE id = ?", [plano_id]);
    const plano = planos[0];

    if (!plano) return res.status(404).json({ message: "Plano não encontrado." });

    const empresaId = plano.empresa_id;
    const mpConfig = await getMpConfig(empresaId);

    if (!mpConfig?.access_token) {
      return res.status(400).json({ message: "Configuração do Mercado Pago não encontrada." });
    }

    // CPF vindo do corpo (publico) precisa ter digitos verificadores validos.
    if (cpf && !validarCPF(String(cpf))) {
      return res.status(400).json({ message: "CPF inválido." });
    }

    // Buscar CPF e telefone do cliente
    let clienteCpf = cpf || null;
    let clienteTelefone = null;
    if (cliente_id) {
      // Endpoint publico: o lead tem que ser da empresa do plano (cliente_id e' sequencial)
      const [[cliente]] = await db.query("SELECT cpf, telefone FROM leads WHERE id = ? AND empresa_id = ?", [cliente_id, empresaId]);
      if (!clienteCpf && cliente?.cpf) clienteCpf = cliente.cpf.replace(/\D/g, "");
      clienteTelefone = cliente?.telefone || null;
    }

    // Pagar pelo CPF de quem tem acesso ativo em outro aparelho troca a senha e funde o
    // tempo dele na conta de quem paga: recusa ANTES de cobrar.
    if (await bloqueiaPagamentoAlheio({ cpf: clienteCpf, mac, empresaId })) {
      return res.status(409).json({ message: MSG_PAGAMENTO_ALHEIO, requer_data_nascimento: true });
    }

    // Cupom: todo o calculo e' do servidor; codigo invalido NAO cai em cobranca cheia (o cliente decide).
    let valorCobrar = Number(plano.valor);
    let cupomAplicado = null;
    if (typeof cupom === "string" && cupom.trim()) {
      const rc = await resolverCupom({ empresaId, plano, codigo: cupom, cpf: clienteCpf, mac, clienteId: cliente_id });
      if (!rc.ok) return res.status(400).json({ message: MSG_CUPOM_INVALIDO });
      valorCobrar = rc.valor_final;
      cupomAplicado = rc;
    }

    // Prioriza portal_id explicito (vindo do redirect entre portais), VALIDADO
    // contra a empresa do plano (endpoint publico — nunca confiar no body).
    // Fallback: resolver via mikrotiks.portal_id (caminho direto sem redirect).
    const portalIdPix = (await validarPortalDaEmpresa(portalIdInput, empresaId))
      || await resolvePortalIdByMikrotik(plano.mikrotik_id, empresaId);

    const payerEmail = resolvePayerEmail(mpConfig);

    // 1. INSERT pagamento ANTES de chamar MP (igual o cartao faz).
    //    Permite usar o id interno como external_reference e o webhook
    //    consegue casar via match no formato `pag_X_emp_Y` mesmo se a
    //    request travar entre o POST do MP e o INSERT.
    const [insertPix] = await db.query(`
      INSERT INTO pagamentos (empresa_id, cliente_id, plano_id, ip, mac, cpf, nome_plano, valor, status, metodo_pagamento, portal_id, telefone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aguardando', 'pix', ?, ?)
    `, [empresaId, cliente_id || null, plano.id, ip, mac, clienteCpf, plano.nome, valorCobrar, portalIdPix, clienteTelefone]);
    const pagId = insertPix.insertId;
    if (cupomAplicado) {
      if (cupomAplicado.indicacao) await vincularIndicacao(pagId, cupomAplicado, clienteCpf); // codigo de indicacao (sem cupom_id)
      else await db.query("UPDATE pagamentos SET cupom_id = ?, valor_original = ? WHERE id = ?", [cupomAplicado.cupom.id, cupomAplicado.valor_original, pagId]);
    }

    // 2. Monta notification_url baseado no host do request.
    //    CRITICO em multi-tenant: master e aluno podem usar a mesma conta MP,
    //    mas o painel da aplicacao MP so aceita 1 webhook URL global. Sem este
    //    campo no body, o MP usa a URL global do painel - se ela aponta pro
    //    master, o aluno NUNCA recebe webhook do PIX.
    //    Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
    const baseUrl = baseUrlPublica(req);

    // 3. POST /v1/payments com notification_url e external_reference contendo o id interno
    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: valorCobrar / 100,
        description: plano.nome,
        payment_method_id: "pix",
        external_reference: `pag_${pagId}_emp_${empresaId}`,
        notification_url: `${baseUrl}/api/pagamentos/notificacao`,
        payer: {
          email: payerEmail
        }
      },
      {
        headers: {
          Authorization: `Bearer ${mpConfig.access_token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": uuidv4()
        },
      }
    );

    const { qr_code_base64, qr_code } = response.data.point_of_interaction.transaction_data;
    const mpPagamentoId = response.data.id;

    // 4. UPDATE com o mp_pagamento_id retornado pelo MP
    await db.query(
      "UPDATE pagamentos SET mp_pagamento_id = ? WHERE id = ?",
      [mpPagamentoId, pagId]
    );

    res.json({
      qr_code_base64,
      copia_cola: qr_code,
      mp_pagamento_id: mpPagamentoId,
      pagamento_id: pagId,  // id interno, usado pro pix-trial endpoint
    });
  } catch (error) {
    console.error("Erro ao gerar pagamento:", error.response?.data || error.message);
    res.status(500).json({ message: "Erro ao gerar pagamento." });
  }
};

// Mapa de status_detail do Mercado Pago para mensagens PT-BR amigaveis.
// Lista completa baseada na doc oficial:
// https://www.mercadopago.com/developers/pt/docs/checkout-api-payments/response-handling/collection-results
const MP_ERROR_MESSAGES = {
  accredited: "Pagamento aprovado.",
  pending_contingency: "Pagamento em processamento. Em instantes voce recebera o resultado.",
  pending_review_manual: "Pagamento em revisao manual.",
  cc_rejected_bad_filled_card_number: "Numero do cartao incorreto. Verifique e tente novamente.",
  cc_rejected_bad_filled_date: "Data de validade incorreta.",
  cc_rejected_bad_filled_security_code: "Codigo de seguranca (CVV) incorreto.",
  cc_rejected_bad_filled_other: "Verifique os dados do cartao.",
  cc_rejected_blacklist: "Nao foi possivel processar o pagamento.",
  cc_rejected_call_for_authorize: "Voce precisa autorizar este pagamento com seu banco.",
  cc_rejected_card_disabled: "Cartao desabilitado. Ligue para o banco para ativar.",
  cc_rejected_card_error: "Nao conseguimos processar este cartao.",
  cc_rejected_duplicated_payment: "Voce ja efetuou um pagamento com esses dados. Aguarde alguns minutos ou use outro cartao.",
  cc_rejected_high_risk: "Pagamento recusado por seguranca. Tente outro cartao ou meio de pagamento.",
  cc_rejected_insufficient_amount: "Saldo insuficiente no cartao.",
  cc_rejected_invalid_installments: "Este cartao nao processa pagamentos parcelados.",
  cc_rejected_max_attempts: "Voce excedeu o numero de tentativas. Tente outro cartao ou aguarde.",
  cc_rejected_other_reason: "Pagamento recusado pela operadora do cartao.",
};
const MP_ERROR_FALLBACK = "Pagamento recusado. Tente outro cartao ou meio de pagamento.";

// Cache em memoria do BIN lookup. TTL 24h. Chave inclui amount pq o endpoint
// /payment_methods/installments e o unico que filtra de fato por BIN, e ele
// exige amount > min_allowed_amount.
const BIN_CACHE = new Map();
const BIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Busca payment_method_id e issuer_id a partir dos primeiros 6 digitos do cartao.
// Doc: GET /v1/payment_methods/installments?bin=XXXXXX&amount=Y&public_key=...
// (esse endpoint, ao contrario de /payment_methods/search, filtra de verdade por BIN
//  e retorna apenas o meio de pagamento daquele BIN especifico).
// Retorna { payment_method_id, issuer_id, payment_type_id } ou lanca erro.
async function lookupBin(bin, amount, publicKey) {
  if (!bin || bin.length < 6) {
    throw new Error("BIN invalido (precisa de 6 digitos).");
  }
  const cacheKey = bin;
  const cached = BIN_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < BIN_CACHE_TTL_MS) {
    return cached.value;
  }

  const url = `https://api.mercadopago.com/v1/payment_methods/installments?bin=${encodeURIComponent(bin)}&amount=${encodeURIComponent(amount)}&public_key=${encodeURIComponent(publicKey)}`;
  const resp = await axios.get(url, { timeout: 5000 });

  const results = Array.isArray(resp.data) ? resp.data : [];
  // Preferir credit_card se houver mais de um (debito + credito).
  const credit = results.find(r => r.payment_type_id === "credit_card") || results[0];
  if (!credit) {
    throw new Error("Bandeira do cartao nao suportada.");
  }
  const issuerIdRaw = credit.issuer?.id;
  const issuerIdNum = issuerIdRaw != null ? parseInt(issuerIdRaw, 10) : null;
  const value = {
    payment_method_id: credit.payment_method_id,
    issuer_id: Number.isFinite(issuerIdNum) ? issuerIdNum : null,
    payment_type_id: credit.payment_type_id || "credit_card",
  };
  if (!value.payment_method_id) {
    throw new Error("Bandeira do cartao nao suportada.");
  }
  BIN_CACHE.set(cacheKey, { ts: Date.now(), value });
  return value;
}

// Divide nome em first_name (1o token) e last_name (resto). Sem allocations exoticas.
function splitNome(nomeCompleto) {
  const partes = (nomeCompleto || "").trim().split(/\s+/);
  if (partes.length === 0 || partes[0] === "") return { first_name: "", last_name: "" };
  if (partes.length === 1) return { first_name: partes[0], last_name: partes[0] };
  return { first_name: partes[0], last_name: partes.slice(1).join(" ") };
}

// Helper: busca config MP e access_token por empresa
async function getMpConfig(empresaId) {
  const [[empresaConfig]] = await db.query(
    "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'mercadopago'",
    [empresaId]
  );
  if (empresaConfig) {
    const cfg = typeof empresaConfig.config_json === 'string'
      ? JSON.parse(empresaConfig.config_json)
      : empresaConfig.config_json;
    return cfg;
  }
  // Fallback legada
  const config = await getConfig(empresaId);
  return config ? { access_token: config.access_token, public_key: config.public_key } : null;
}

// Helper: resolve email do pagador
function resolvePayerEmail(mpConfig) {
  if (mpConfig?.email_pagador) return mpConfig.email_pagador.trim();
  return "comprador@pagamento.com";
}

// Proxy do endpoint de device sessions do MP. Existe porque o walled garden
// do captive portal so libera o primeiro dominio - api.mercadopago.com fica
// bloqueado no celular do cliente. O frontend chama esse endpoint (mesmo
// dominio do portal, ja na walled garden) e o backend repassa pro MP.
//
// Endpoints proxyed:
//   POST /api/pagamentos/mp-device-session/web_device
//   POST /api/pagamentos/mp-device-session/anonymous_device_session
exports.proxyDeviceSession = async (req, res) => {
  const tipo = req.params.tipo;
  if (tipo !== "web_device" && tipo !== "anonymous_device_session") {
    return res.status(400).json({ error: "tipo invalido" });
  }
  try {
    const url = `https://api.mercadopago.com/v1/device_sessions/${tipo}`;
    // Encaminha User-Agent e Accept-Language do cliente real pra que o MP
    // veja a sessao como originada do browser do usuario, nao do servidor.
    // Cuidado: NAO encaminhar X-Forwarded-For com IPs invalidos (::1, 10.x do
    // hotspot, 127.x) - o MP devolve 500 nesse caso. So encaminha IPv4 publico.
    const fwdHeaders = { "Content-Type": "application/json" };
    if (req.headers["user-agent"]) fwdHeaders["User-Agent"] = req.headers["user-agent"];
    if (req.headers["accept-language"]) fwdHeaders["Accept-Language"] = req.headers["accept-language"];

    const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const isPublicIPv4 = (ip) => {
      if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
      const [a, b] = ip.split(".").map(Number);
      if (a === 10) return false;                          // 10.0.0.0/8
      if (a === 127) return false;                         // loopback
      if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
      if (a === 192 && b === 168) return false;            // 192.168.0.0/16
      if (a === 169 && b === 254) return false;            // link-local
      if (a === 0 || a >= 224) return false;               // 0/8, multicast/reserved
      return true;
    };
    if (isPublicIPv4(xff)) fwdHeaders["X-Forwarded-For"] = xff;

    const mpResp = await axios.post(url, req.body || {}, {
      headers: fwdHeaders,
      timeout: 8000,
      validateStatus: () => true,
    });
    res.status(mpResp.status).json(mpResp.data);
  } catch (err) {
    console.error("proxyDeviceSession erro:", err.message);
    res.status(502).json({ error: "proxy falhou", message: err.message });
  }
};

exports.obterPublicKey = async (req, res) => {
  try {
    const { empresa_id } = req.query;
    if (!empresa_id) return res.status(400).json({ message: "empresa_id obrigatorio." });

    const cfg = await getMpConfig(empresa_id);
    if (!cfg?.public_key) {
      return res.status(404).json({ message: "Public key nao configurada." });
    }
    res.json({ public_key: cfg.public_key });
  } catch (error) {
    console.error("Erro ao obter public key:", error.message);
    res.status(500).json({ message: "Erro ao obter configuracao." });
  }
};

exports.gerarPagamentoCartao = async (req, res) => {
  const {
    card_number,
    cardholder_name,
    expiration_month,
    expiration_year,
    security_code,
    identification_number,
    plano_id,
    mac,
    ip,
    cpf,
    cliente_id,
    cupom,
    device_session_id,
    portal_id: portalIdInput,
  } = req.body;

  console.log("💳 gerarPagamentoCartao body:", { plano_id, cliente_id });

  // 1. Validacao de input
  //
  // IMPORTANTE: existem DOIS CPFs distintos nesse fluxo:
  //   - cardholderCpf: CPF do TITULAR DO CARTAO (obrigatorio pelo MP no token).
  //                    Pode ser diferente do cliente (ex: filho usa cartao do pai).
  //                    So e' usado no /v1/card_tokens como cardholder.identification.
  //   - clienteCpf:    CPF do LEAD (cliente_id). E' o que vira username no RADIUS,
  //                    fica gravado em pagamentos.cpf, e e' passado pro liberarUsuario.
  //                    Resolvido APOS buscar o lead (mais abaixo).
  // Nao confundir: se misturar, a Laura recebe no WhatsApp dela o CPF do pai como login.
  const cardDigits = (card_number || "").replace(/\D/g, "");
  const cvv = (security_code || "").trim();
  const nome = (cardholder_name || "").trim();
  const cardholderCpf = (identification_number || cpf || "").replace(/\D/g, "");
  const expMonth = parseInt(expiration_month, 10);
  const expYearRaw = parseInt(expiration_year, 10);
  const expYear = expYearRaw < 100 ? 2000 + expYearRaw : expYearRaw;

  if (cardDigits.length < 13 || cardDigits.length > 19) {
    return res.status(400).json({ message: "Numero do cartao invalido." });
  }
  if (!cvv || cvv.length < 3 || cvv.length > 4) {
    return res.status(400).json({ message: "CVV invalido." });
  }
  if (!nome || nome.length < 2) {
    return res.status(400).json({ message: "Nome no cartao obrigatorio." });
  }
  if (cardholderCpf.length !== 11) {
    return res.status(400).json({ message: "CPF invalido." });
  }
  if (!expMonth || expMonth < 1 || expMonth > 12) {
    return res.status(400).json({ message: "Mes de validade invalido." });
  }
  if (!expYear || expYear < 2024 || expYear > 2099) {
    return res.status(400).json({ message: "Ano de validade invalido." });
  }
  if (!plano_id) {
    return res.status(400).json({ message: "Plano nao informado." });
  }

  let pagId = null;
  try {
    // 2. Buscar plano + config MP
    const [planos] = await db.query("SELECT * FROM planos WHERE id = ?", [plano_id]);
    const plano = planos[0];
    if (!plano) return res.status(404).json({ message: "Plano nao encontrado." });

    const empresaId = plano.empresa_id;
    const mpConfig = await getMpConfig(empresaId);
    if (!mpConfig?.access_token || !mpConfig?.public_key) {
      return res.status(400).json({ message: "Configuracao do Mercado Pago nao encontrada." });
    }

    let valorReais = parseFloat(plano.valor) / 100;
    let valorCobrar = Number(plano.valor);
    let cupomAplicado = null;

    // Resolver email do pagador: prioridade lead (real) > config (placeholder) > fallback.
    // Email real do comprador melhora muito a aprovacao do antifraude.
    let payerEmail = resolvePayerEmail(mpConfig);
    let leadInfo = null;
    if (cliente_id) {
      try {
        const [[lead]] = await db.query(
          "SELECT id, nome, email, cpf, telefone FROM leads WHERE id = ? AND empresa_id = ? LIMIT 1",
          [cliente_id, empresaId]
        );
        if (lead) {
          leadInfo = lead;
          if (lead.email && lead.email.includes("@")) payerEmail = lead.email.trim();
        }
      } catch (e) {
        console.warn("nao foi possivel buscar lead:", e.message);
      }
    }

    const { first_name, last_name } = splitNome(nome);

    // Resolver portal_id: prioriza o explicito (redirect entre portais),
    // VALIDADO contra a empresa do plano (endpoint publico).
    // Fallback pro mikrotiks.portal_id (caminho legado direto).
    const portalIdPagto = (await validarPortalDaEmpresa(portalIdInput, empresaId))
      || await resolvePortalIdByMikrotik(plano.mikrotik_id, empresaId);
    const telefonePagto = leadInfo?.telefone || null;

    // CPF do CLIENTE (identidade no sistema):
    //   - Se existe lead, usa o CPF do lead (Laura, por exemplo).
    //   - Se nao existe lead, cai pro CPF do form (pode ser que o usuario nao passou
    //     por CadastroCliente, ex: portal antigo). Ai o CPF do cartao vira identidade.
    const clienteCpf = (leadInfo?.cpf || cardholderCpf || "").replace(/\D/g, "") || null;

    // Mesma trava do PIX: nao cobrar quem paga pelo CPF de um acesso ativo em outro aparelho.
    if (await bloqueiaPagamentoAlheio({ cpf: clienteCpf, mac, empresaId })) {
      return res.status(409).json({ message: MSG_PAGAMENTO_ALHEIO, requer_data_nascimento: true });
    }

    // Cupom (calculo so no servidor): invalido = recusa antes de cobrar, nunca cobranca cheia silenciosa.
    if (typeof cupom === "string" && cupom.trim()) {
      const rc = await resolverCupom({ empresaId, plano, codigo: cupom, cpf: clienteCpf, mac, clienteId: cliente_id });
      if (!rc.ok) return res.status(400).json({ message: MSG_CUPOM_INVALIDO });
      valorCobrar = rc.valor_final;
      valorReais = valorCobrar / 100;
      cupomAplicado = rc;
    }

    // 3. INSERT pagamento aguardando ANTES de qualquer chamada ao MP
    //    (assim temos o id interno pra usar como external_reference; o webhook
    //    consegue casar mesmo se a request travar entre /payments e o INSERT).
    //    Gravamos o CPF do CLIENTE (lead), nao o do titular do cartao.
    const [insertResult] = await db.query(
      `INSERT INTO pagamentos (empresa_id, cliente_id, plano_id, ip, mac, cpf, pagador_cpf, nome_plano, valor, status, metodo_pagamento, portal_id, telefone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando', 'cartao', ?, ?)`,
      // pagador_cpf = CPF do TITULAR DO CARTAO (informado no formulario): so confirma o CPF do
      // cadastro se for o mesmo (pai pagando pelo filho nao confirma o CPF do filho).
      [empresaId, cliente_id || null, plano.id, ip, mac, clienteCpf, cardholderCpf || null, plano.nome, valorCobrar, portalIdPagto, telefonePagto]
    );
    pagId = insertResult.insertId;
    if (cupomAplicado) {
      if (cupomAplicado.indicacao) await vincularIndicacao(pagId, cupomAplicado, clienteCpf); // codigo de indicacao (sem cupom_id)
      else await db.query("UPDATE pagamentos SET cupom_id = ?, valor_original = ? WHERE id = ?", [cupomAplicado.cupom.id, cupomAplicado.valor_original, pagId]);
    }

    // 4. BIN lookup -> payment_method_id + issuer_id (obrigatorios pela doc)
    const bin = cardDigits.slice(0, 6);
    let binInfo;
    try {
      binInfo = await lookupBin(bin, valorReais, mpConfig.public_key);
    } catch (binErr) {
      console.error("💳 BIN lookup falhou:", binErr.message);
      await db.query("UPDATE pagamentos SET status = 'rejected', observacao = ? WHERE id = ?",
        [`bin_lookup: ${binErr.message}`, pagId]);
      return res.status(400).json({ message: binErr.message });
    }

    // 5. Criar card token (server-side, public_key na query string)
    const tokenResponse = await axios.post(
      `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(mpConfig.public_key)}`,
      {
        card_number: cardDigits,
        security_code: cvv,
        expiration_month: expMonth,
        expiration_year: expYear,
        cardholder: {
          name: nome,
          // CPF do TITULAR DO CARTAO (nao do cliente). Pode ser diferente quando
          // o cliente usa cartao de terceiro (ex: filho usando cartao do pai).
          identification: { type: "CPF", number: cardholderCpf },
        },
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const cardToken = tokenResponse.data?.id;
    if (!cardToken) {
      await db.query("UPDATE pagamentos SET status = 'rejected', observacao = 'token_vazio' WHERE id = ?", [pagId]);
      return res.status(400).json({ message: "Erro ao validar dados do cartao." });
    }

    // 6. Criar pagamento.
    //
    //    LICOES APRENDIDAS (gravadas em sangue, NAO mexer sem entender):
    //
    //    1. NAO enviar `additional_info.ip_address` - o IP do hotspot e privado
    //       (10.x) e o antifraude do MP marca como suspeito, derrubando aprovacao.
    //
    //    2. NAO enviar `payer.first_name`, `payer.last_name`, `payer.identification`
    //       no body do /v1/payments. O MP IGNORA esses campos no payment quando
    //       voce usa um token (ele usa o cardholder do token como fonte da verdade).
    //       Se voce envia algo divergente, o antifraude marca como suspeito.
    //       Validado em 2026-04-08 com cc_rejected_high_risk: a resposta da API
    //       devolveu payer.first_name=null, identification=null - prova que MP
    //       descarta esses campos. Tudo que importa pro payer e' o EMAIL.
    //
    //    3. NAO enviar `additional_info.payer` (mesmo motivo do item 2 - duplica
    //       o cardholder e quebra antifraude).
    //
    //    4. SIM enviar `payment_method_id` e `issuer_id` do BIN lookup - a doc
    //       lista como obrigatorios e a falta deles deixa o MP "adivinhando".
    //
    //    5. SIM enviar `additional_info.items[]` - dados do produto sao OK
    //       e ajudam o antifraude.
    //
    //    6. Email do pagador deve ser real. Se cliente_id veio na request, usar
    //       o email do lead. Email placeholder com dominio fake aciona antifraude.
    const baseUrl = baseUrlPublica(req);

    const paymentBody = {
      transaction_amount: valorReais,
      token: cardToken,
      description: plano.nome,
      installments: 1,
      payment_method_id: binInfo.payment_method_id,
      issuer_id: binInfo.issuer_id || undefined,
      statement_descriptor: "HOTSPOT WIFI",
      external_reference: `pag_${pagId}_emp_${empresaId}`,
      notification_url: `${baseUrl}/api/pagamentos/notificacao`,
      capture: true,
      binary_mode: false,
      payer: {
        email: payerEmail,
      },
      additional_info: {
        items: [{
          id: String(plano.id),
          title: plano.nome,
          description: `Acesso WiFi ${plano.duracao_minutos || 60} min`,
          category_id: "services",
          quantity: 1,
          unit_price: valorReais,
        }],
      },
    };

    // Device session id do MP security.js (frontend). E o maior fator unico
    // de aprovacao do antifraude segundo a doc - sem ele o tracking_id fica
    // "security:none" e tudo cai em high_risk em modo producao.
    if (device_session_id) {
      paymentBody.metadata = { device_session_id };
    }

    const paymentHeaders = {
      Authorization: `Bearer ${mpConfig.access_token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": uuidv4(),
    };
    if (device_session_id) {
      paymentHeaders["X-meli-session-id"] = device_session_id;
    }

    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      paymentBody,
      { headers: paymentHeaders, timeout: 30000 }
    );

    const mpPagamentoId = response.data.id;
    const mpStatus = response.data.status;
    const statusDetail = response.data.status_detail;
    console.log(`💳 MP cartao response: status=${mpStatus} status_detail=${statusDetail} id=${mpPagamentoId}`);

    // 7. Tratar resposta
    const duracao = plano.duracao_minutos || 60;

    if (mpStatus === "approved") {
      // Atomic: marca status=approved + liberado_em na mesma UPDATE, so executa
      // o corpo se for a PRIMEIRA vez (webhook concorrente pode ter chegado antes).
      const [marker] = await db.query(
        `UPDATE pagamentos
           SET status = 'approved', mp_pagamento_id = ?,
               expira_em = DATE_ADD(NOW(), INTERVAL ? MINUTE),
               liberado_em = NOW()
         WHERE id = ? AND liberado_em IS NULL`,
        [mpPagamentoId, duracao, pagId]
      );
      if (marker.affectedRows > 0) await registrarUsoCupom(pagId);

      let gateway = null;
      let username = null;
      let credLiberada = null; // { username, password } real gravado em radcheck
      if (marker.affectedRows > 0) {
        try {
          credLiberada = await liberarUsuario({
            mac, ip, plano: plano.nome, empresa_id: empresaId,
            // CPF do CLIENTE (lead), nao do titular do cartao. E o que vira username RADIUS.
            cpf: clienteCpf,
            cliente_id: cliente_id || null,
            portal_id: portalIdPagto,
            telefone: telefonePagto,
            contexto_tipo: "pagamento_cartao",
            empilharTempo: true, // so com marcador pagamentos.liberado_em (1 liberacao por pagamento)
            referencia_id: pagId,
          });
        } catch (liberarErr) {
          console.error("Erro ao liberar usuario apos cartao approved:", liberarErr.message);
          // Reverter marker pra webhook/polling poder retry
          await db.query(
            "UPDATE pagamentos SET liberado_em = NULL, observacao = ? WHERE id = ?",
            [`Erro ao liberar: ${liberarErr.message}`.slice(0, 250), pagId]
          );
        }
      }
      try {
        const [mkResult] = await db.query(
          "SELECT m.end_hotspot, m.ip FROM mikrotiks m WHERE m.id = ? LIMIT 1",
          [plano.mikrotik_id]
        );
        gateway = mkResult[0]?.end_hotspot || mkResult[0]?.ip || null;
        username = clienteCpf || mac;
      } catch (e) {
        console.warn("Falha ao buscar gateway apos cartao approved:", e.message);
      }

      const finalUsername = credLiberada?.username || username || mac;
      // Senha REAL do radcheck (aleatoria). Se outro caminho (webhook) liberou antes,
      // le do banco; ultimo recurso = username (usuarios legados senha==username).
      let senhaCartao = credLiberada?.password || null;
      if (!senhaCartao) {
        try { senhaCartao = await obterSenhaRadius(finalUsername); } catch (e) { /* cai no fallback */ }
      }
      // Branch por vendor: Omada/UniFi precisam de gateway_info pro passo final
      // (browserauth / redirect); MikroTik segue o fluxo legado.
      const gatewayInfo = await montarGatewayInfo({
        mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username: finalUsername,
      });
      return res.json({
        status: "approved",
        gateway,
        username: finalUsername,
        password: senhaCartao || finalUsername,
        mp_pagamento_id: mpPagamentoId,
        gateway_info: gatewayInfo,
        // Acesso pago ja aberto em OUTRO aparelho: o portal oferece "desconectar a anterior e conectar aqui"
        ...(await tratarSessaoAtiva({ username: finalUsername, mac, empresaId, manterMesmoAparelho: true })),
      });
    }

    if (mpStatus === "rejected") {
      const mensagem = MP_ERROR_MESSAGES[statusDetail] || MP_ERROR_FALLBACK;
      await db.query(
        "UPDATE pagamentos SET status = 'rejected', mp_pagamento_id = ?, observacao = ? WHERE id = ?",
        [mpPagamentoId, statusDetail || "rejected", pagId]
      );
      return res.status(400).json({
        status: "rejected",
        message: mensagem,
        status_detail: statusDetail,
      });
    }

    // in_process / pending - frontend faz polling em /api/pagamentos/status
    await db.query(
      "UPDATE pagamentos SET mp_pagamento_id = ? WHERE id = ?",
      [mpPagamentoId, pagId]
    );
    return res.json({
      status: "pending",
      mp_pagamento_id: mpPagamentoId,
      message: "Pagamento em processamento. Aguarde...",
    });
  } catch (error) {
    const mpError = error.response?.data;
    console.error("💳 [ERRO] gerar pagamento cartao:");
    console.error("   message:", error.message);
    console.error("   http_status:", error.response?.status || "n/a");
    console.error("   mp_response:", mpError ? JSON.stringify(mpError).slice(0, 600) : "n/a");

    if (pagId) {
      await db.query("UPDATE pagamentos SET status = 'rejected', observacao = ? WHERE id = ?",
        [(mpError?.message || error.message).slice(0, 250), pagId]).catch(() => {});
    }

    if (mpError?.cause?.[0]?.description) {
      return res.status(400).json({ message: mpError.cause[0].description });
    }
    if (mpError?.message) {
      return res.status(400).json({ message: mpError.message });
    }
    return res.status(500).json({ message: "Erro ao processar pagamento com cartao." });
  }
};

exports.notificacaoWebhook = async (req, res) => {
  // Log de entrada bruto - dispara ANTES de qualquer validacao pra
  // confirmar que o webhook esta realmente chegando ao servidor.
  console.log("[webhook MP] recebido:", {
    headers_sig: req.headers["x-signature"]?.slice(0, 60),
    headers_req_id: req.headers["x-request-id"],
    body_topic: req.body?.topic || req.body?.type,
    body_data_id: req.body?.data?.id,
    body_action: req.body?.action,
  });
  try {
    const topic = req.body.topic || req.body.type;
    if (topic !== "payment") {
      console.log("[webhook MP] topic !== payment, ignorando:", topic);
      return res.sendStatus(200);
    }

    const mpPagamentoId = req.body.data?.id;
    if (!mpPagamentoId) {
      console.log("[webhook MP] sem data.id, retornando 400");
      return res.sendStatus(400);
    }

    // Tentar descobrir a empresa pelo pagamento existente.
    // Tambem guardamos o status ANTERIOR pra detectar webhook duplicado:
    // se o pagamento ja estava 'approved' antes deste webhook chegar, entao
    // ja foi processado (pelo direct response do /gerar-cartao ou webhook previo)
    // e NAO devemos chamar liberarUsuario de novo (senao dispara WhatsApp dobrado).
    const [existente] = await db.query(
      "SELECT id, empresa_id, status, valor FROM pagamentos WHERE mp_pagamento_id = ?",
      [mpPagamentoId]
    );

    let empresaId = existente[0]?.empresa_id || null;
    const statusAnterior = existente[0]?.status || null;

    // Validacao opcional da assinatura x-signature do webhook MP.
    // Se a empresa tiver `webhook_secret` em empresa_configs.config_json.mercadopago,
    // valida HMAC-SHA256; senao, pula (modo compat). Se a empresa ainda nao foi
    // descoberta (primeira chamada do webhook antes do match por external_reference),
    // tambem pula - validacao acontece apenas quando ja conseguimos identificar a empresa.
    if (empresaId) {
      const cfgSig = await getMpConfig(empresaId);
      const secret = cfgSig?.webhook_secret || null;
      if (!validarAssinaturaWebhook(req.headers, mpPagamentoId, secret)) {
        console.warn(`[webhook MP] 401 assinatura invalida (mp_id=${mpPagamentoId} empresa=${empresaId}). Verifique webhook_secret em empresa_configs.`);
        return res.sendStatus(401);
      }
    }

    // Buscar token de acesso
    let accessToken;
    if (empresaId) {
      const [[empresaConfig]] = await db.query(
        "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'mercadopago'",
        [empresaId]
      );
      if (empresaConfig) {
        const cfg = typeof empresaConfig.config_json === 'string'
          ? JSON.parse(empresaConfig.config_json)
          : empresaConfig.config_json;
        accessToken = cfg.access_token;
      }
    }

    // Fallback para config legada
    if (!accessToken) {
      const config = await getConfig(empresaId);
      accessToken = config?.access_token;
    }

    if (!accessToken) {
      console.warn(`[webhook MP] 401 sem access_token (mp_id=${mpPagamentoId} empresa=${empresaId || 'desconhecida'}). Tipico do webhook de TESTE do painel MP (data.id=123456 nao existe no banco) ou empresa sem config MP cadastrada.`);
      return res.sendStatus(401);
    }

    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${mpPagamentoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const pagamento = response.data;

    // O corpo do webhook nao e confiavel; a fonte da verdade e o pagamento buscado no MP. Mesmo assim,
    // o pagamento do MP tem que ser o MESMO registro interno (referencia e valor), senao um pagamento
    // real e barato de outra empresa/plano aprovaria um pagamento caro ainda em aberto.
    if (existente.length > 0 && pagamento.status === "approved") {
      const ref = String(pagamento.external_reference || "").match(/^pag_(\d+)_emp_(\d+)$/);
      if (ref && (Number(ref[1]) !== Number(existente[0].id) || Number(ref[2]) !== Number(existente[0].empresa_id))) {
        console.warn(`[webhook MP] external_reference nao confere (mp_id=${mpPagamentoId}): nao aprova`);
        return res.sendStatus(200);
      }
      const esperado = Number(existente[0].valor) / 100; // pagamentos.valor guarda CENTAVOS; o MP devolve reais
      const pago = Number(pagamento.transaction_amount);
      if (Number.isFinite(esperado) && esperado > 0 && Number.isFinite(pago) && Math.abs(esperado - pago) > 0.01) {
        console.warn(`[webhook MP] valor pago (${pago}) diferente do esperado (${esperado}) (mp_id=${mpPagamentoId}): nao aprova`);
        return res.sendStatus(200);
      }
    }

    // Extrair empresa_id da external_reference se não temos ainda
    if (!empresaId && pagamento.external_reference) {
      const match = pagamento.external_reference.match(/empresa_(\d+)|emp_(\d+)/);
      if (match) empresaId = parseInt(match[1] || match[2], 10);
    }

    // Checkout Pro: external_reference no formato "pag_X_emp_Y" - lookup por id interno
    // pra encontrar a row pre-criada com mp_pagamento_id=preference_id e atualizar pra
    // o payment_id real.
    if (existente.length === 0 && pagamento.external_reference) {
      const pagMatch = pagamento.external_reference.match(/^pag_(\d+)_emp_(\d+)$/);
      if (pagMatch) {
        const internalId = parseInt(pagMatch[1], 10);
        const [byInternal] = await db.query(
          "SELECT id, empresa_id FROM pagamentos WHERE id = ?",
          [internalId]
        );
        if (byInternal.length > 0) {
          existente.push(byInternal[0]);
          empresaId = empresaId || byInternal[0].empresa_id;
          await db.query(
            "UPDATE pagamentos SET mp_pagamento_id = ? WHERE id = ?",
            [mpPagamentoId, internalId]
          );
          console.log(`webhook: matched pag_id=${internalId} via external_reference, mp_pagamento_id atualizado`);
        }
      }
    }

    if (pagamento.status === "approved") {
      const planoNome = pagamento.description;
      const valorPago = pagamento.transaction_amount;
      const email = pagamento.payer?.email || null;

      if (existente.length > 0) {
        // Buscar plano filtrando por empresa
        const planoQuery = empresaId
          ? "SELECT duracao_minutos FROM planos WHERE nome = ? AND empresa_id = ? LIMIT 1"
          : "SELECT duracao_minutos FROM planos WHERE nome = ? LIMIT 1";
        const planoParams = empresaId ? [planoNome, empresaId] : [planoNome];
        const [planoInfo] = await db.query(planoQuery, planoParams);
        const duracao = planoInfo[0]?.duracao_minutos || 60;

        // So aprova quem ainda nao foi aprovado/expirado: um webhook repetido (ou forjado) nao pode
        // renovar `expira_em` nem reativar um pagamento ja vencido (acesso gratis indefinido).
        await db.query(
          `UPDATE pagamentos SET status = 'approved', email = ?, expira_em = DATE_ADD(NOW(), INTERVAL ? MINUTE)
           WHERE mp_pagamento_id = ? AND status NOT IN ('approved', 'expirado')`,
          [email, duracao, mpPagamentoId]
        );

        // CPF de quem PAGOU (dado do banco no PIX): so ele pode confirmar o CPF do cadastro
        // (leadUtils.cpfConfirmado). Nunca bloqueia a liberacao; ausente = marcador DESCONHECIDO (nao confirma).
        try {
          const pagadorCpf = extrairCpfPagador(pagamento);
          // Sem dado do banco o pagamento NAO confirma o CPF (marcador); so legado NULL conta.
          await db.query(
            "UPDATE pagamentos SET pagador_cpf = ? WHERE mp_pagamento_id = ? AND pagador_cpf IS NULL",
            [pagadorCpf || PAGADOR_DESCONHECIDO, mpPagamentoId]
          );
          if (!pagadorCpf) {
            console.warn(`[webhook MP] PIX aprovado sem CPF do pagador (mp_id=${mpPagamentoId} empresa=${empresaId || "-"}): nao confirma o CPF`);
          } else {
            const [[reg]] = await db.query("SELECT cpf FROM pagamentos WHERE mp_pagamento_id = ? LIMIT 1", [mpPagamentoId]);
            if (reg?.cpf && !cpfCompativel(pagadorCpf, reg.cpf)) {
              console.warn(`[webhook MP] pagador diferente do CPF do cadastro (mp_id=${mpPagamentoId} empresa=${empresaId || "-"}): nao confirma o CPF`);
            }
          }
        } catch (pagErr) {
          console.warn("[webhook MP] nao gravou pagador_cpf:", pagErr.message);
        }
      } else {
        const planoQuery = empresaId
          ? "SELECT id, duracao_minutos FROM planos WHERE nome = ? AND empresa_id = ? LIMIT 1"
          : "SELECT id, duracao_minutos FROM planos WHERE nome = ? LIMIT 1";
        const planoParams = empresaId ? [planoNome, empresaId] : [planoNome];
        const [planos] = await db.query(planoQuery, planoParams);
        const planoId = planos[0]?.id || null;
        const duracao = planos[0]?.duracao_minutos || 60;

        await db.query(`
          INSERT INTO pagamentos (empresa_id, plano_id, email, nome_plano, valor, status, mp_pagamento_id, expira_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))
        `, [empresaId, planoId, email, planoNome, valorPago, pagamento.status, mpPagamentoId, duracao]);
      }

      const [info] = await db.query(
        "SELECT id, mac, IP as ip, nome_plano, empresa_id, cpf, cliente_id, portal_id, telefone FROM pagamentos WHERE mp_pagamento_id = ?",
        [mpPagamentoId]
      );
      const {
        id: pagIdWebhook,
        mac, ip, nome_plano,
        empresa_id: pagEmpresaId,
        cpf: pagCpf,
        cliente_id: pagClienteId,
        portal_id: pagPortalId,
        telefone: pagTelefone,
      } = info[0] || {};

      // Idempotencia atomica via liberado_em (unificada entre webhook, polling,
      // direct response do cartao). Se affectedRows > 0, esta request e' a
      // primeira a liberar este pagamento. Se = 0, outro caminho ja liberou.
      let marcado = false;
      if (mac && nome_plano) {
        const [m] = await db.query(
          "UPDATE pagamentos SET liberado_em = NOW() WHERE id = ? AND status = 'approved' AND liberado_em IS NULL",
          [pagIdWebhook]
        );
        marcado = m.affectedRows > 0;
        if (marcado) await registrarUsoCupom(pagIdWebhook);
      }

      if (marcado) {
        try {
          await liberarUsuario({
            mac,
            ip,
            plano: nome_plano,
            empresa_id: pagEmpresaId || empresaId,
            cpf: pagCpf || null,
            cliente_id: pagClienteId || null,
            portal_id: pagPortalId || null,
            telefone: pagTelefone || null,
            contexto_tipo: "pagamento_pix",
            empilharTempo: true, // so com marcador pagamentos.liberado_em (1 liberacao por pagamento)
            referencia_id: pagIdWebhook,
          });
        } catch (liberarErr) {
          console.error("Erro ao liberar usuario após pagamento aprovado:", liberarErr.message);
          // Reverter marker pra permitir retry em webhook/polling seguinte
          await db.query(
            "UPDATE pagamentos SET liberado_em = NULL, observacao = ? WHERE id = ?",
            [`Erro ao liberar: ${liberarErr.message}`, pagIdWebhook]
          );
        }
      } else if (mac && nome_plano) {
        console.log(`webhook: pagamento ${pagIdWebhook} ja foi liberado antes, pulando (idempotencia)`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
};

exports.listarPagamentosAprovados = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, plano_id, nome_plano, email, valor, status, criado_em, mp_pagamento_id
      FROM pagamentos
      WHERE status = 'approved' AND empresa_id = ?
      ORDER BY criado_em DESC
    `, [req.empresa_id]);
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar pagamentos:", error);
    res.status(500).json({ message: "Erro ao buscar pagamentos." });
  }
};

exports.listarTodosPagamentos = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, plano_id, nome_plano, email, valor, status, criado_em, mac, ip, mp_pagamento_id
      FROM pagamentos
      WHERE empresa_id = ?
      ORDER BY criado_em DESC
    `, [req.empresa_id]);
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar pagamentos:", error);
    res.status(500).json({ message: "Erro ao buscar pagamentos." });
  }
};

exports.liberarManual = async (req, res) => {
  try {
    const { id } = req.params;

    const [pagamento] = await db.query(
      "SELECT id, mac, IP as ip, nome_plano, plano_id, cpf, cliente_id, portal_id, telefone FROM pagamentos WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );

    if (!pagamento.length) {
      return res.status(404).json({ message: "Pagamento não encontrado." });
    }

    const { mac, ip, nome_plano, plano_id, cpf: pagCpf, cliente_id: pagClienteId, portal_id: pagPortalId, telefone: pagTelefone } = pagamento[0];

    const [planoInfo] = await db.query(
      "SELECT duracao_minutos FROM planos WHERE id = ?",
      [plano_id]
    );
    const duracao = planoInfo[0]?.duracao_minutos || 60;

    await liberarUsuario({
      mac, ip, plano: nome_plano, empresa_id: req.empresa_id, cpf: pagCpf || null,
      cliente_id: pagClienteId || null,
      portal_id: pagPortalId || null,
      telefone: pagTelefone || null,
      contexto_tipo: "liberacao_manual",
      referencia_id: parseInt(id, 10),
    });

    await db.query(
      "UPDATE pagamentos SET status = 'approved', expira_em = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ? AND empresa_id = ?",
      [duracao, id, req.empresa_id]
    );

    res.json({ message: "Usuário liberado manualmente." });
  } catch (error) {
    console.error("Erro ao liberar manualmente:", error.message);
    res.status(500).json({ message: "Erro ao liberar manualmente." });
  }
};

exports.verificarStatusPagamento = async (req, res) => {
  try {
    const { mac, ip, pagamento_id } = req.query;

    // Proof-of-possession: exige pagamento_id + mac do MESMO registro. Sem
    // isso o endpoint publico era enumeravel por MAC/IP global e vazava
    // credenciais de pagamentos de qualquer empresa. O escopo de empresa e'
    // o proprio registro (empresa_id do pagamento casado).
    if (!pagamento_id || !mac) {
      return res.status(400).json({ status: "parametros_invalidos" });
    }

    const [pagamento] = await db.query(
      "SELECT id, status, nome_plano, empresa_id, cpf, cliente_id, portal_id, telefone FROM pagamentos WHERE mp_pagamento_id = ? AND LOWER(mac) = LOWER(?) LIMIT 1",
      [pagamento_id, mac]
    );

    if (!pagamento.length) {
      return res.status(404).json({ status: "nao_encontrado" });
    }

    const {
      id: pagIdStatus,
      status, nome_plano,
      empresa_id: pagEmpresaId,
      cpf: pagCpf,
      cliente_id: pagClienteId,
      portal_id: pagPortalId,
      telefone: pagTelefone,
    } = pagamento[0];

    // Buscar MikroTik filtrando por empresa
    const mkQuery = pagEmpresaId
      ? `SELECT m.id AS mikrotik_id, m.end_hotspot, m.ip FROM mikrotiks m JOIN planos p ON p.mikrotik_id = m.id WHERE p.nome = ? AND p.empresa_id = ? LIMIT 1`
      : `SELECT m.id AS mikrotik_id, m.end_hotspot, m.ip FROM mikrotiks m JOIN planos p ON p.mikrotik_id = m.id WHERE p.nome = ? LIMIT 1`;
    const mkParams = pagEmpresaId ? [nome_plano, pagEmpresaId] : [nome_plano];
    const [mikrotikResult] = await db.query(mkQuery, mkParams);

    const mikrotik = mikrotikResult[0];
    const gateway = mikrotik?.end_hotspot || mikrotik?.ip || null;

    let senhaLiberada = null; // senha real (radcheck) quando ESTA request liberou
    if (status === "approved") {
      // Idempotencia atomica: tenta marcar 'liberado_em' se ainda nao foi liberado.
      // Se affectedRows > 0 -> este e' o primeiro request que vai liberar, segue.
      // Se = 0 -> outro request ja liberou (ex: webhook anterior, outro polling) -> skip.
      // ESSA logica substitui a checagem "radcheck existe?" antiga, que era BUG:
      // se o cliente ja tinha radcheck de pagamento anterior esgotado, o sistema
      // pulava liberarUsuario e deixava credenciais velhas (sem saldo) -> MikroTik
      // rejeitava o login e cliente caia de volta no captive portal.
      const [marker] = await db.query(
        "UPDATE pagamentos SET liberado_em = NOW() WHERE id = ? AND status = 'approved' AND liberado_em IS NULL",
        [pagIdStatus]
      );
      if (marker.affectedRows > 0) await registrarUsoCupom(pagIdStatus);
      if (marker.affectedRows > 0) {
        try {
          const cred = await liberarUsuario({
            mac, ip, plano: nome_plano, empresa_id: pagEmpresaId, cpf: pagCpf || null,
            cliente_id: pagClienteId || null,
            portal_id: pagPortalId || null,
            telefone: pagTelefone || null,
            contexto_tipo: "pagamento_pix",
            empilharTempo: true, // so com marcador pagamentos.liberado_em (1 liberacao por pagamento)
            referencia_id: pagIdStatus,
          });
          if (cred?.password) senhaLiberada = cred.password;
        } catch (liberarErr) {
          console.error("Erro ao liberar usuario no status check:", liberarErr.message);
          // Reverter marker pra permitir retry numa proxima chamada
          await db.query("UPDATE pagamentos SET liberado_em = NULL WHERE id = ?", [pagIdStatus]);
        }
      }
    }

    const cpfLimpoResp = pagCpf ? pagCpf.replace(/\D/g, "") : null;
    const usernameResp = cpfLimpoResp || mac;

    // GUARD: se status=approved mas radcheck ainda nao existe no RADIUS, e'
    // porque outra request concorrente (webhook ou polling anterior) ainda
    // esta rodando liberarUsuario. Retornar 'approved' aqui mandaria o
    // frontend redirecionar pro MikroTik antes do FreeRADIUS ter as
    // credenciais, e o cliente cairia de volta no captive portal. Melhor
    // "fingir" pending - o proximo polling tentara de novo e radcheck ja
    // estara la.
    let senhaResp = null;
    if (status === "approved") {
      // Senha vem do radcheck (aleatoria). Com pagamentoId, so vale se a liberacao
      // deste pagamento ja terminou (evita devolver senha de ciclo anterior
      // enquanto outra request ainda regrava as credenciais).
      senhaResp = senhaLiberada || await obterSenhaRadius(usernameResp, { pagamentoId: pagIdStatus });
      if (!senhaResp) {
        return res.json({
          status: "pending",
          gateway: null,
          username: null,
          liberando: true, // flag opcional pro frontend mostrar "liberando..."
        });
      }
    }

    // Resposta publica NAO retorna cpf. Retorna `password` (agora ALEATORIA, lida do
    // radcheck, nao mais == username/CPF) so quando approved: o redirect de auto-login
    // precisa dela. Protegido pela prova de posse (mp_pagamento_id + mac do MESMO registro).
    // gateway_info: branch por vendor (Omada browserauth / UniFi redirect).
    const gatewayInfoStatus = status === "approved"
      ? await montarGatewayInfo({
          mikrotik_id: mikrotik?.mikrotik_id, empresa_id: pagEmpresaId, mac, username: usernameResp,
        })
      : null;
    res.json({
      status, gateway, username: usernameResp,
      ...(status === "approved" && senhaResp ? { password: senhaResp } : {}),
      gateway_info: gatewayInfoStatus,
      // Acesso pago ja aberto em OUTRO aparelho: o portal oferece "desconectar a anterior e conectar aqui"
      ...(status === "approved" && senhaResp
        ? await tratarSessaoAtiva({ username: usernameResp, mac, empresaId: pagEmpresaId, manterMesmoAparelho: true })
        : {}),
    });
  } catch (error) {
    console.error("Erro ao verificar status:", error.message);
    res.status(500).json({ message: "Erro interno ao verificar status." });
  }
};

// ============================================================================
// PIX TRIAL - Acesso free de N minutos ao clicar em "copiar PIX"
// ============================================================================
// Logica:
//   1. Portal tem que ter pix_trial_enabled=true em configuracoes (JSON)
//   2. CPF obrigatorio (vem do lead via cliente_id OU do proprio pagamento)
//   3. Rate limit: 1 trial por CPF a cada 24h
//   4. Excecao do rate limit: se o ultimo trial deu em pagamento approved,
//      usuario pode gerar novo trial (cliente legitimo). Se NAO pagou, bloqueia.
//   5. Marca pagamentos.trial_liberado_em = NOW() pra rastrear
//   6. Cria usuario RADIUS temporario via gerarAcessoTemporario

exports.liberarPixTrial = async (req, res) => {
  try {
    // Prova de posse (como o /status): o id interno e' sequencial, entao so ele nao basta — sem
    // mp_pagamento_id + mac do MESMO registro qualquer um trocaria a senha do CPF de outro pagamento.
    const { pagamento_id, mp_pagamento_id, mac: macReq } = req.body || {};
    if (!pagamento_id || !mp_pagamento_id || !macReq) {
      return res.status(400).json({ message: "pagamento_id, mp_pagamento_id e mac obrigatorios" });
    }

    // Buscar pagamento com dados do plano e portal
    const [[pag]] = await db.query(
      `SELECT p.id, p.mac, p.IP as ip, p.cpf, p.cliente_id, p.portal_id, p.plano_id,
              p.empresa_id, p.status, p.trial_liberado_em,
              pl.mikrotik_id, pl.nome as plano_nome,
              po.configuracoes as portal_config
         FROM pagamentos p
         LEFT JOIN planos pl ON pl.id = p.plano_id
         LEFT JOIN portais po ON po.id = p.portal_id AND po.empresa_id = p.empresa_id
        WHERE p.id = ? AND p.mp_pagamento_id = ? AND LOWER(p.mac) = LOWER(?) LIMIT 1`,
      [pagamento_id, String(mp_pagamento_id), String(macReq)]
    );

    if (!pag) return res.status(404).json({ message: "Pagamento nao encontrado" });

    // 0. Uma vez por pagamento (e so enquanto ele esta em aberto): quem ja recebeu o acesso gratis deste
    //    PIX nao tem as credenciais regravadas (trocaria a senha de quem esta conectado), e pagamento
    //    ja aprovado/expirado nao precisa de trial. O front trata 409 como "ja liberado".
    if (pag.trial_liberado_em) {
      return res.status(409).json({ ja_liberado: true, message: "Acesso gratis ja utilizado neste pagamento" });
    }
    if (pag.status === "approved" || pag.status === "expirado") {
      return res.status(409).json({ message: "Pagamento ja finalizado" });
    }

    // 1. Verificar se portal tem o trial habilitado
    let portalCfg = {};
    try {
      if (pag.portal_config) {
        portalCfg = typeof pag.portal_config === "string"
          ? JSON.parse(pag.portal_config)
          : pag.portal_config;
      }
    } catch (e) { /* JSON invalido -> config vazia */ }

    if (!portalCfg.pix_trial_enabled) {
      return res.status(403).json({ message: "Trial desativado neste portal" });
    }

    const duracaoMin = parseInt(portalCfg.pix_trial_duracao_minutos || 5, 10);
    const duracaoSeg = duracaoMin * 60;

    // 2. Resolver CPF: direto do pagamento ou via cliente_id -> lead
    let cpfCliente = pag.cpf ? String(pag.cpf).replace(/\D/g, "") : null;
    if (!cpfCliente && pag.cliente_id) {
      const [[lead]] = await db.query(
        "SELECT cpf FROM leads WHERE id = ? LIMIT 1",
        [pag.cliente_id]
      );
      cpfCliente = lead?.cpf ? String(lead.cpf).replace(/\D/g, "") : null;
    }

    if (!cpfCliente) {
      return res.status(400).json({ message: "CPF obrigatorio para liberar acesso free" });
    }

    // 3. Rate limit 24h (comportamento do portal de pagamento):
    //    - cada passada pelo portal pode ganhar um trial novo, ate MAX_TRIALS
    //      nao-pagos por CPF na janela de 24h; a partir dai bloqueia (tem que pagar)
    //    - trials cujo pagamento foi approved NAO contam (cliente legitimo)
    const MAX_TRIALS_24H = 2;
    const [trials] = await db.query(
      `SELECT id, status, trial_liberado_em
         FROM pagamentos
        WHERE (REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ? OR LOWER(mac) = LOWER(?))
          AND trial_liberado_em IS NOT NULL
          AND trial_liberado_em > DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND status <> 'approved'
        ORDER BY trial_liberado_em DESC`,
      [cpfCliente, pag.mac || ""]
    );

    if (trials.length >= MAX_TRIALS_24H) {
      const maisAntigo = trials[trials.length - 1];
      const proximoPermitido = new Date(
        new Date(maisAntigo.trial_liberado_em).getTime() + 24 * 60 * 60 * 1000
      );
      return res.status(429).json({
        message: "Voce ja usou o acesso free 2 vezes. Realize o pagamento para continuar navegando.",
        retry_after: proximoPermitido.toISOString(),
      });
    }

    // 3.1 Acesso do CPF ja aberto em OUTRO aparelho: gerarAcessoTemporario regravaria as credenciais
    //     do acesso que esta no ar e o login daqui seria recusado (Simultaneous-Use=1). Antes de tocar
    //     no RADIUS, devolve o aviso; o cliente decide e o front repete o pedido depois de desconectar.
    //     Nada e' gravado (nem trial_liberado_em), entao nao consome o limite de trials.
    const sessaoAberta = await tratarSessaoAtiva({
      username: cpfCliente, mac: pag.mac, empresaId: pag.empresa_id, manterMesmoAparelho: true,
    });
    if (sessaoAberta.requer_desconexao) {
      return res.json({ ok: false, username: cpfCliente, ...sessaoAberta });
    }

    // 4. Criar usuario RADIUS ja com o CPF (usuario definitivo). Assim, quando o
    //    pagamento for aprovado, liberarUsuario faz upgrade da sessao ativa via CoA
    //    (sem reconexao) em vez de criar um usuario pixfree_ separado (1.7).
    const { username, password, gateway } = await gerarAcessoTemporario(
      pag.mac,
      pag.ip,
      pag.plano_id,
      pag.empresa_id,
      {
        username: cpfCliente,
        duracaoSegundos: duracaoSeg,
        rateLimit: "2M/2M",
      }
    );

    // 5. Marca no pagamento que o trial foi liberado
    await db.query(
      "UPDATE pagamentos SET trial_liberado_em = NOW() WHERE id = ?",
      [pag.id]
    );

    const gatewayInfoTrial = await montarGatewayInfo({
      mikrotik_id: pag.mikrotik_id, empresa_id: pag.empresa_id, mac: pag.mac,
      username, duracaoSegundos: duracaoSeg,
    });

    res.json({
      ok: true,
      username,
      password,
      gateway,
      duracao_minutos: duracaoMin,
      message: `Acesso liberado por ${duracaoMin} minutos`,
      gateway_info: gatewayInfoTrial,
    });
  } catch (err) {
    console.error("Erro em liberarPixTrial:", err);
    res.status(500).json({ message: "Erro ao liberar acesso free" });
  }
};

// Helpers do fluxo de cartao reaproveitados pela cobranca de assinatura SaaS (assinaturaController).
exports.helpersMp = { lookupBin, splitNome, MP_ERROR_MESSAGES, MP_ERROR_FALLBACK };
