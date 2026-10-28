const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { baseUrlPublica } = require("../utils/baseUrl");
const db = require("../../db");
const { validarAssinaturaWebhook } = require("../utils/mpSignature");
const { obterStatus, invalidar, tabelaInexistente } = require("../utils/assinatura");

// ---------- helpers ----------

async function getPlataformaMp() {
  const [[row]] = await db.execute("SELECT config_json FROM plataforma_configs WHERE chave = 'mercadopago'");
  if (!row) return null;
  return typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
}

const mascarar = (v) => (v ? `${String(v).slice(0, 8)}...` : "");

// Adicionais que o sistema ja sabe aplicar (Fase 1): sobem o limite de equipamentos/admins.
const TIPOS_ADICIONAL = ["equipamentos", "admins", "portais", "whatsapp", "campanhas", "exportacao", "sem_marca", "dominio"];
const TIPOS_APLICAVEIS = ["equipamentos", "admins", "portais", "whatsapp", "campanhas", "exportacao", "dominio"];
const TIPOS_LIGA_DESLIGA = ["whatsapp", "campanhas", "exportacao", "dominio"]; // quantidade fixa 1; o plano pode ja incluir
const MAX_QUANTIDADE = 20;
const TIPO_PLANO_MAX = { equipamentos: "plano_max_equipamentos", admins: "plano_max_admins", portais: "plano_max_portais" };

/** Por que a empresa NAO pode comprar este adicional agora (null = pode). Funcao pura. */
function motivoIndisponivel(adicional, st, ordemAtual, ordemMinimo, renovacao = false) {
  if (!TIPOS_APLICAVEIS.includes(adicional.tipo)) return "Recurso ainda não disponível.";
  if (!st || !["trial", "ativa"].includes(st.status)) return "Renove o plano antes de comprar adicionais.";
  if (adicional.plano_minimo_id != null && (ordemAtual == null || ordemMinimo == null || ordemAtual < ordemMinimo)) {
    return `Disponível a partir do plano ${adicional.plano_minimo_nome || "superior"}.`;
  }
  if (TIPOS_LIGA_DESLIGA.includes(adicional.tipo)) {
    // Compra nova: recusa se ja tem o recurso (plano OU adicional vigente). Renovacao: so se o plano ja inclui.
    const ja = renovacao ? st.plano_recursos && st.plano_recursos[adicional.tipo] : st.recursos && st.recursos[adicional.tipo];
    if (ja) return "Este recurso já está incluído no seu plano" + (renovacao ? "." : " ou em um adicional ativo.");
    return null;
  }
  if (st[TIPO_PLANO_MAX[adicional.tipo]] == null) return "Seu plano já é ilimitado neste recurso.";
  return null;
}

async function ordemDoPlano(planoId) {
  if (planoId == null) return null;
  const [[p]] = await db.execute("SELECT ordem FROM saas_planos WHERE id = ?", [planoId]);
  return p ? Number(p.ordem) : null;
}

/**
 * Item a cobrar: plano (`plano_id`), adicional novo (`adicional_id` + `quantidade`) ou renovacao
 * (`renovar_adicional_id`). Valor SEMPRE calculado aqui, nunca vem do cliente.
 * @returns {{erro?: {status:number, message:string}, item?: Object}}
 */
async function resolverItem(b, empresaId) {
  const renovarId = parseInt(b.renovar_adicional_id, 10);
  const adicionalId = parseInt(b.adicional_id, 10);
  if (!renovarId && !adicionalId) {
    const planoId = parseInt(b.plano_id, 10);
    const [[plano]] = await db.execute("SELECT id, nome, valor FROM saas_planos WHERE id = ? AND ativo = 1", [planoId]);
    if (!plano) return { erro: { status: 404, message: "Plano não encontrado." } };
    return { item: { tipo: "plano", id: plano.id, valor: Number(plano.valor), titulo: `Assinatura ${plano.nome}`, nome: plano.nome, cobranca: { plano_id: plano.id } } };
  }

  let quantidade = Math.floor(Number(b.quantidade) || 1);
  let compraId = null;
  let idAdicional = adicionalId;
  if (renovarId) {
    const [[compra]] = await db.execute("SELECT id, adicional_id, quantidade FROM assinatura_adicionais WHERE id = ? AND empresa_id = ?", [renovarId, empresaId]);
    if (!compra) return { erro: { status: 404, message: "Adicional não encontrado." } };
    compraId = compra.id; idAdicional = compra.adicional_id; quantidade = compra.quantidade;
  }
  if (quantidade < 1 || quantidade > MAX_QUANTIDADE) return { erro: { status: 400, message: `Quantidade deve ser de 1 a ${MAX_QUANTIDADE}.` } };

  const [[ad]] = await db.execute(
    `SELECT a.id, a.nome, a.tipo, a.valor, a.plano_minimo_id, pm.nome AS plano_minimo_nome, pm.ordem AS plano_minimo_ordem
       FROM saas_adicionais a LEFT JOIN saas_planos pm ON pm.id = a.plano_minimo_id
      WHERE a.id = ? AND a.ativo = 1`,
    [idAdicional]
  );
  if (!ad) return { erro: { status: 404, message: "Adicional não encontrado." } };
  if (TIPOS_LIGA_DESLIGA.includes(ad.tipo) && quantidade !== 1) return { erro: { status: 400, message: "Este recurso é contratado com quantidade 1." } };
  const st = await obterStatus(empresaId);
  const motivo = motivoIndisponivel(ad, st, await ordemDoPlano(st.plano_id), ad.plano_minimo_ordem == null ? null : Number(ad.plano_minimo_ordem), !!renovarId);
  if (motivo) return { erro: { status: 409, message: motivo } };
  return {
    item: {
      tipo: "adicional", id: ad.id, valor: Math.round(Number(ad.valor) * quantidade * 100) / 100,
      titulo: `Adicional ${ad.nome}${quantidade > 1 ? ` x${quantidade}` : ""}`, nome: ad.nome,
      cobranca: { adicional_id: ad.id, quantidade, assinatura_adicional_id: compraId },
    },
  };
}

/** INSERT da cobranca. Plano usa o INSERT original (funciona mesmo sem a migration 041). */
async function inserirCobranca(empresaId, item, metodo) {
  const c = item.cobranca;
  if (item.tipo === "plano") {
    const [r] = await db.execute(
      "INSERT INTO assinatura_cobrancas (empresa_id, plano_id, valor, metodo, status) VALUES (?, ?, ?, ?, 'aguardando')",
      [empresaId, c.plano_id, item.valor, metodo]
    );
    return r.insertId;
  }
  const [r] = await db.execute(
    "INSERT INTO assinatura_cobrancas (empresa_id, plano_id, valor, metodo, status, adicional_id, quantidade, assinatura_adicional_id) VALUES (?, NULL, ?, ?, 'aguardando', ?, ?, ?)",
    [empresaId, item.valor, metodo, c.adicional_id, c.quantidade, c.assinatura_adicional_id || null]
  );
  return r.insertId;
}

/** Aplica um pagamento aprovado: marca a cobranca (atomico) e estende a assinatura. */
async function ativarPorCobranca(cobranca) {
  // Idempotencia: so quem transiciona aguardando->aprovada estende o periodo.
  const [r] = await db.execute(
    "UPDATE assinatura_cobrancas SET status = 'aprovada', pago_em = NOW() WHERE id = ? AND status <> 'aprovada'",
    [cobranca.id]
  );
  if (r.affectedRows !== 1) return false;

  if (cobranca.adicional_id) {
    const [[ad]] = await db.execute("SELECT ciclo_dias FROM saas_adicionais WHERE id = ?", [cobranca.adicional_id]);
    const cicloAd = ad?.ciclo_dias || 30;
    if (cobranca.assinatura_adicional_id) {
      await db.execute(
        "UPDATE assinatura_adicionais SET vence_em = DATE_ADD(GREATEST(NOW(), vence_em), INTERVAL ? DAY) WHERE id = ? AND empresa_id = ?",
        [cicloAd, cobranca.assinatura_adicional_id, cobranca.empresa_id]
      );
    } else {
      await db.execute(
        "INSERT INTO assinatura_adicionais (empresa_id, adicional_id, quantidade, vence_em) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
        [cobranca.empresa_id, cobranca.adicional_id, cobranca.quantidade || 1, cicloAd]
      );
    }
    invalidar(cobranca.empresa_id);
    return true;
  }

  const [[plano]] = await db.execute("SELECT ciclo_dias FROM saas_planos WHERE id = ?", [cobranca.plano_id]);
  const ciclo = plano?.ciclo_dias || 30;
  await db.execute(
    `INSERT INTO assinaturas (empresa_id, plano_id, status, vence_em)
     VALUES (?, ?, 'ativa', DATE_ADD(NOW(), INTERVAL ? DAY))
     ON DUPLICATE KEY UPDATE
       plano_id = VALUES(plano_id),
       status = 'ativa',
       ultimo_aviso = NULL,
       vence_em = DATE_ADD(GREATEST(NOW(), COALESCE(vence_em, NOW())), INTERVAL ? DAY)`,
    [cobranca.empresa_id, cobranca.plano_id, ciclo, ciclo]
  );
  invalidar(cobranca.empresa_id);
  return true;
}

/** Consulta o pagamento no MP (fonte da verdade) e ativa se aprovado e o valor bater. */
async function sincronizarCobranca(cobranca, cfg) {
  if (!cobranca.mp_pagamento_id || !cfg?.access_token) return cobranca.status;
  const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${cobranca.mp_pagamento_id}`, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
  });
  if (data.external_reference !== `ass_${cobranca.id}_emp_${cobranca.empresa_id}`) return cobranca.status;
  if (data.status === "approved") {
    if (Math.abs(Number(data.transaction_amount) - Number(cobranca.valor)) > 0.009) {
      console.error(`[assinatura] valor divergente na cobranca ${cobranca.id}`);
      return cobranca.status;
    }
    await ativarPorCobranca(cobranca);
    return "aprovada";
  }
  if (["rejected", "cancelled"].includes(data.status)) {
    await db.execute("UPDATE assinatura_cobrancas SET status = 'recusada' WHERE id = ? AND status = 'aguardando'", [cobranca.id]);
    return "recusada";
  }
  return cobranca.status;
}

// Cartao: server-side, mesmo pipeline do hotspot (BIN lookup -> card_token -> /v1/payments),
// com as mesmas regras de payload (ver docs/CHECKOUT-CARTAO-MP.md). Dados do cartao nunca sao gravados nem logados.
exports.pagarCartao = async (req, res) => {
  const { lookupBin, MP_ERROR_MESSAGES, MP_ERROR_FALLBACK } = require("./pagamentoController").helpersMp;
  const b = req.body || {};
  const cardDigits = String(b.card_number || "").replace(/\D/g, "");
  const cvv = String(b.security_code || "").trim();
  const nome = String(b.cardholder_name || "").trim();
  const cpf = String(b.identification_number || "").replace(/\D/g, "");
  const mes = parseInt(b.expiration_month, 10);
  const anoRaw = parseInt(b.expiration_year, 10);
  const ano = anoRaw < 100 ? 2000 + anoRaw : anoRaw;

  if (cardDigits.length < 13 || cardDigits.length > 19) return res.status(400).json({ message: "Número do cartão inválido." });
  if (cvv.length < 3 || cvv.length > 4) return res.status(400).json({ message: "CVV inválido." });
  if (nome.length < 2) return res.status(400).json({ message: "Nome no cartão obrigatório." });
  if (cpf.length !== 11) return res.status(400).json({ message: "CPF do titular inválido." });
  if (!mes || mes < 1 || mes > 12) return res.status(400).json({ message: "Mês de validade inválido." });
  if (!ano || ano < new Date().getFullYear() || ano > 2099) return res.status(400).json({ message: "Ano de validade inválido." });
  if (!b.device_session_id) return res.status(400).json({ message: "Ambiente seguro não carregado. Recarregue a página." });

  let cobrancaId = null;
  try {
    const { erro, item } = await resolverItem(b, req.empresa_id);
    if (erro) return res.status(erro.status).json({ message: erro.message });

    const cfg = await getPlataformaMp();
    if (!cfg?.access_token || !cfg?.public_key) return res.status(503).json({ message: "Pagamento indisponível no momento. Fale com o suporte." });

    const empresaId = req.empresa_id;
    const [[empresa]] = await db.execute("SELECT email FROM empresas WHERE id = ?", [empresaId]);
    const valor = item.valor;

    cobrancaId = await inserirCobranca(empresaId, item, "cartao");

    let bin;
    try { bin = await lookupBin(cardDigits.slice(0, 6), valor, cfg.public_key); }
    catch (e) {
      await db.execute("UPDATE assinatura_cobrancas SET status = 'recusada' WHERE id = ?", [cobrancaId]);
      return res.status(400).json({ message: e.message });
    }

    const tokenResp = await axios.post(
      `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(cfg.public_key)}`,
      { card_number: cardDigits, security_code: cvv, expiration_month: mes, expiration_year: ano,
        cardholder: { name: nome, identification: { type: "CPF", number: cpf } } },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );
    const token = tokenResp.data?.id;
    if (!token) {
      await db.execute("UPDATE assinatura_cobrancas SET status = 'recusada' WHERE id = ?", [cobrancaId]);
      return res.status(400).json({ message: "Erro ao validar dados do cartão." });
    }

    const baseUrl = baseUrlPublica(req);
    const { data } = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: valor,
        token,
        description: item.titulo,
        installments: 1,
        payment_method_id: bin.payment_method_id,
        issuer_id: bin.issuer_id || undefined,
        statement_descriptor: "APEXTELECOM",
        external_reference: `ass_${cobrancaId}_emp_${empresaId}`,
        notification_url: `${baseUrl}/api/assinatura/webhook`,
        capture: true,
        binary_mode: false,
        metadata: { device_session_id: b.device_session_id },
        payer: { email: (empresa?.email || cfg.email_pagador || "").trim() },
        additional_info: { items: [{ id: `${item.tipo}_${item.id}`, title: item.titulo, category_id: "services", quantity: 1, unit_price: valor }] },
      },
      { headers: { Authorization: `Bearer ${cfg.access_token}`, "Content-Type": "application/json", "X-Idempotency-Key": uuidv4(), "X-meli-session-id": b.device_session_id }, timeout: 30000 }
    );

    await db.execute("UPDATE assinatura_cobrancas SET mp_pagamento_id = ? WHERE id = ?", [String(data.id), cobrancaId]);

    if (data.status === "rejected") {
      await db.execute("UPDATE assinatura_cobrancas SET status = 'recusada' WHERE id = ?", [cobrancaId]);
      return res.status(400).json({ status: "rejected", message: MP_ERROR_MESSAGES[data.status_detail] || MP_ERROR_FALLBACK });
    }

    // approved/pending: confirma no MP (valor e referencia) e ativa; pending segue por polling/webhook
    const [[c]] = await db.execute("SELECT * FROM assinatura_cobrancas WHERE id = ?", [cobrancaId]);
    const status = await sincronizarCobranca(c, cfg);
    res.json({ id: cobrancaId, status: status === "aprovada" ? "approved" : "pending" });
  } catch (err) {
    const mpError = err.response?.data;
    console.error("[assinatura] erro no cartão:", err.message, mpError ? JSON.stringify(mpError).slice(0, 400) : "");
    if (cobrancaId) await db.execute("UPDATE assinatura_cobrancas SET status = 'recusada' WHERE id = ? AND status = 'aguardando'", [cobrancaId]).catch(() => {});
    if (mpError?.cause?.[0]?.description) return res.status(400).json({ message: mpError.cause[0].description });
    if (mpError?.message) return res.status(400).json({ message: mpError.message });
    res.status(500).json({ message: "Erro ao processar pagamento com cartão." });
  }
};

// ---------- empresa ----------

exports.planosPublicos = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT * FROM saas_planos WHERE ativo = 1 ORDER BY ordem, id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar planos SaaS:", err.message);
    res.status(500).json({ message: "Erro ao listar planos" });
  }
};

exports.status = async (req, res) => {
  try {
    const st = await obterStatus(req.empresa_id);
    const [[eq]] = await db.execute("SELECT COUNT(*) AS n FROM mikrotiks WHERE empresa_id = ?", [req.empresa_id]);
    const [[po]] = await db.execute("SELECT COUNT(*) AS n FROM portais WHERE empresa_id = ?", [req.empresa_id]);
    const [[ad]] = await db.execute("SELECT COUNT(*) AS n FROM admins WHERE empresa_id = ?", [req.empresa_id]);
    res.json({ ...st, uso: { equipamentos: eq.n, admins: ad.n, portais: po.n } });
  } catch (err) {
    console.error("Erro ao obter assinatura:", err.message);
    res.status(500).json({ message: "Erro ao obter assinatura" });
  }
};

// Catalogo de adicionais ativos + o que a empresa ja comprou (vigentes e vencidos ha <= 30 dias, para renovar).
exports.adicionaisEmpresa = async (req, res) => {
  try {
    const st = await obterStatus(req.empresa_id);
    const ordemAtual = await ordemDoPlano(st.plano_id);
    const [cat] = await db.execute(
      `SELECT a.id, a.nome, a.descricao, a.tipo, a.incremento, a.valor, a.ciclo_dias, a.plano_minimo_id,
              pm.nome AS plano_minimo_nome, pm.ordem AS plano_minimo_ordem
         FROM saas_adicionais a LEFT JOIN saas_planos pm ON pm.id = a.plano_minimo_id
        WHERE a.ativo = 1 ORDER BY a.ordem, a.id`
    );
    const catalogo = cat.map((a) => {
      const motivo = motivoIndisponivel(a, st, ordemAtual, a.plano_minimo_ordem == null ? null : Number(a.plano_minimo_ordem));
      return { id: a.id, nome: a.nome, descricao: a.descricao, tipo: a.tipo, incremento: a.incremento, valor: Number(a.valor),
               ciclo_dias: a.ciclo_dias, plano_minimo_nome: a.plano_minimo_nome || null, disponivel: !motivo, motivo };
    });
    const [minhas] = await db.execute(
      `SELECT aa.id, aa.adicional_id, aa.quantidade, aa.vence_em, a.nome, a.tipo, a.valor
         FROM assinatura_adicionais aa JOIN saas_adicionais a ON a.id = aa.adicional_id
        WHERE aa.empresa_id = ? AND aa.vence_em >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY aa.vence_em DESC`,
      [req.empresa_id]
    );
    const agora = Date.now();
    res.json({
      catalogo,
      minhas: minhas.map((m) => ({ id: m.id, adicional_id: m.adicional_id, nome: m.nome, tipo: m.tipo, quantidade: m.quantidade,
        valor: Number(m.valor), vence_em: m.vence_em, vigente: new Date(m.vence_em).getTime() >= agora })),
    });
  } catch (err) {
    if (tabelaInexistente(err)) return res.json({ catalogo: [], minhas: [] }); // migration 041 ainda nao rodou
    console.error("Erro ao listar adicionais:", err.message);
    res.status(500).json({ message: "Erro ao listar adicionais" });
  }
};

exports.criarCobranca = async (req, res) => {
  try {
    const { erro, item } = await resolverItem(req.body || {}, req.empresa_id);
    if (erro) return res.status(erro.status).json({ message: erro.message });

    const cfg = await getPlataformaMp();
    if (!cfg?.access_token) return res.status(503).json({ message: "Pagamento indisponível no momento. Fale com o suporte." });

    const empresaId = req.empresa_id;
    const [[empresa]] = await db.execute("SELECT email FROM empresas WHERE id = ?", [empresaId]);

    const cobrancaId = await inserirCobranca(empresaId, item, "pix");

    const baseUrl = baseUrlPublica(req);
    const { data } = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: item.valor,
        description: item.titulo,
        payment_method_id: "pix",
        external_reference: `ass_${cobrancaId}_emp_${empresaId}`,
        notification_url: `${baseUrl}/api/assinatura/webhook`,
        payer: { email: (cfg.email_pagador || empresa?.email || "").trim() },
      },
      { headers: { Authorization: `Bearer ${cfg.access_token}`, "Content-Type": "application/json", "X-Idempotency-Key": uuidv4() } }
    );
    const td = data.point_of_interaction.transaction_data;
    await db.execute(
      "UPDATE assinatura_cobrancas SET mp_pagamento_id = ?, copia_cola = ?, qr_code_base64 = ? WHERE id = ?",
      [String(data.id), td.qr_code, td.qr_code_base64, cobrancaId]
    );
    res.status(201).json({ id: cobrancaId, valor: item.valor, copia_cola: td.qr_code, qr_code_base64: td.qr_code_base64 });
  } catch (err) {
    console.error("Erro ao gerar cobrança de assinatura:", err.response?.data || err.message);
    res.status(500).json({ message: "Erro ao gerar cobrança." });
  }
};

// Polling do front; se o webhook se perdeu, confirma direto no MP.
exports.consultarCobranca = async (req, res) => {
  try {
    const [[c]] = await db.execute("SELECT * FROM assinatura_cobrancas WHERE id = ? AND empresa_id = ?", [req.params.id, req.empresa_id]);
    if (!c) return res.status(404).json({ message: "Cobrança não encontrada." });
    let status = c.status;
    if (status === "aguardando") {
      try { status = await sincronizarCobranca(c, await getPlataformaMp()); }
      catch (e) { console.error("[assinatura] sync cobranca:", e.response?.data || e.message); }
    }
    res.json({ id: c.id, status });
  } catch (err) {
    console.error("Erro ao consultar cobrança:", err.message);
    res.status(500).json({ message: "Erro ao consultar cobrança." });
  }
};

// Webhook publico da PLATAFORMA (separado de /api/pagamentos/notificacao).
exports.webhook = async (req, res) => {
  try {
    const dataId = String(req.body?.data?.id || req.query?.["data.id"] || req.query?.id || "");
    if (!dataId) return res.sendStatus(200);

    const cfg = await getPlataformaMp();
    if (!cfg?.access_token) return res.sendStatus(200);
    if (!validarAssinaturaWebhook(req.headers, dataId, cfg.webhook_secret)) return res.sendStatus(401);

    // Nao confia no corpo: busca o pagamento no MP e casa pela external_reference.
    const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    const m = /^ass_(\d+)_emp_(\d+)$/.exec(data.external_reference || "");
    if (!m) return res.sendStatus(200);
    const [[c]] = await db.execute("SELECT * FROM assinatura_cobrancas WHERE id = ? AND empresa_id = ?", [m[1], m[2]]);
    if (c) {
      if (!c.mp_pagamento_id) await db.execute("UPDATE assinatura_cobrancas SET mp_pagamento_id = ? WHERE id = ?", [String(data.id), c.id]);
      await sincronizarCobranca({ ...c, mp_pagamento_id: c.mp_pagamento_id || String(data.id) }, cfg);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("[assinatura] erro no webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
};

// ---------- super admin ----------

exports.listarPlanosAdmin = async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM saas_planos ORDER BY ordem, id");
  res.json(rows);
};

function dadosPlano(b) {
  const nulo = (v) => (v === "" || v == null ? null : Math.max(0, parseInt(v, 10)) || 0);
  return [
    String(b.nome || "").trim().slice(0, 100),
    b.descricao ? String(b.descricao).slice(0, 255) : null,
    b.gratis ? 0 : Math.max(0, Number(b.valor) || 0),
    Math.max(1, parseInt(b.ciclo_dias, 10) || 30),
    nulo(b.max_equipamentos),
    nulo(b.max_admins),
    b.ativo === false || b.ativo === 0 ? 0 : 1,
    parseInt(b.ordem, 10) || 0,
    b.inclui_whatsapp ? 1 : 0,
    b.inclui_campanhas ? 1 : 0,
    b.inclui_exportacao ? 1 : 0,
    nulo(b.max_portais),
    b.inclui_dominio ? 1 : 0,
    b.gratis ? 1 : 0,
    nulo(b.trial_dias) ? Math.min(nulo(b.trial_dias), 365) : null,
  ];
}

exports.criarPlano = async (req, res) => {
  const d = dadosPlano(req.body);
  if (!d[0]) return res.status(400).json({ message: "Nome é obrigatório" });
  const [r] = await db.execute(
    "INSERT INTO saas_planos (nome, descricao, valor, ciclo_dias, max_equipamentos, max_admins, ativo, ordem, inclui_whatsapp, inclui_campanhas, inclui_exportacao, max_portais, inclui_dominio, gratis, trial_dias) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", d);
  invalidar();
  res.status(201).json({ id: r.insertId });
};

exports.atualizarPlano = async (req, res) => {
  const d = dadosPlano(req.body);
  if (!d[0]) return res.status(400).json({ message: "Nome é obrigatório" });
  await db.execute(
    "UPDATE saas_planos SET nome=?, descricao=?, valor=?, ciclo_dias=?, max_equipamentos=?, max_admins=?, ativo=?, ordem=?, inclui_whatsapp=?, inclui_campanhas=?, inclui_exportacao=?, max_portais=?, inclui_dominio=?, gratis=?, trial_dias=? WHERE id=?",
    [...d, req.params.id]);
  invalidar();
  res.json({ message: "Plano atualizado" });
};

exports.removerPlano = async (req, res) => {
  const [[uso]] = await db.execute("SELECT COUNT(*) AS n FROM assinaturas WHERE plano_id = ?", [req.params.id]);
  if (uso.n > 0) {
    await db.execute("UPDATE saas_planos SET ativo = 0 WHERE id = ?", [req.params.id]);
    return res.json({ message: "Plano em uso: foi desativado em vez de removido" });
  }
  await db.execute("DELETE FROM saas_planos WHERE id = ?", [req.params.id]);
  res.json({ message: "Plano removido" });
};

// ---------- super admin: catalogo de adicionais ----------

exports.listarAdicionaisAdmin = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT a.*, pm.nome AS plano_minimo_nome FROM saas_adicionais a
         LEFT JOIN saas_planos pm ON pm.id = a.plano_minimo_id ORDER BY a.ordem, a.id`
    );
    res.json(rows);
  } catch (err) {
    if (tabelaInexistente(err)) return res.json([]);
    res.status(500).json({ message: "Erro ao listar adicionais" });
  }
};

/** Valida o corpo; devolve { erro } ou { d: [valores na ordem do INSERT] }. */
async function dadosAdicional(b) {
  const nome = String(b.nome || "").trim().slice(0, 100);
  if (!nome) return { erro: "Nome é obrigatório" };
  if (!TIPOS_ADICIONAL.includes(b.tipo)) return { erro: "Tipo inválido" };
  const incremento = Math.floor(Number(b.incremento) || 1);
  if (incremento < 1 || incremento > 1000) return { erro: "Incremento deve ser de 1 a 1000" };
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor < 0) return { erro: "Valor inválido" };
  const ativo = b.ativo === false || b.ativo === 0 ? 0 : 1;
  if (ativo && !TIPOS_APLICAVEIS.includes(b.tipo)) {
    return { erro: "Este tipo ainda não pode ser ativado: ainda não tem efeito no sistema (só equipamentos, administradores, portais, WhatsApp, campanhas e exportação)." };
  }
  let planoMinimo = null;
  if (b.plano_minimo_id !== "" && b.plano_minimo_id != null) {
    planoMinimo = parseInt(b.plano_minimo_id, 10);
    const [[p]] = await db.execute("SELECT id FROM saas_planos WHERE id = ?", [planoMinimo]);
    if (!p) return { erro: "Plano mínimo não encontrado" };
  }
  return { d: [nome, b.descricao ? String(b.descricao).slice(0, 255) : null, b.tipo, incremento, Math.round(valor * 100) / 100,
               Math.max(1, parseInt(b.ciclo_dias, 10) || 30), planoMinimo, ativo, parseInt(b.ordem, 10) || 0] };
}

exports.criarAdicional = async (req, res) => {
  const { erro, d } = await dadosAdicional(req.body || {});
  if (erro) return res.status(400).json({ message: erro });
  const [r] = await db.execute(
    "INSERT INTO saas_adicionais (nome, descricao, tipo, incremento, valor, ciclo_dias, plano_minimo_id, ativo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", d);
  res.status(201).json({ id: r.insertId });
};

exports.atualizarAdicional = async (req, res) => {
  const { erro, d } = await dadosAdicional(req.body || {});
  if (erro) return res.status(400).json({ message: erro });
  await db.execute(
    "UPDATE saas_adicionais SET nome=?, descricao=?, tipo=?, incremento=?, valor=?, ciclo_dias=?, plano_minimo_id=?, ativo=?, ordem=? WHERE id=?",
    [...d, req.params.id]);
  invalidar(); // mudar incremento/tipo muda o limite efetivo de quem ja comprou
  res.json({ message: "Adicional atualizado" });
};

exports.removerAdicional = async (req, res) => {
  const [[vig]] = await db.execute("SELECT COUNT(*) AS n FROM assinatura_adicionais WHERE adicional_id = ? AND vence_em >= NOW()", [req.params.id]);
  if (vig.n > 0) return res.status(409).json({ message: "Há empresas com este adicional vigente. Desative em vez de remover." });
  const [[hist]] = await db.execute("SELECT COUNT(*) AS n FROM assinatura_adicionais WHERE adicional_id = ?", [req.params.id]);
  if (hist.n > 0) {
    await db.execute("UPDATE saas_adicionais SET ativo = 0 WHERE id = ?", [req.params.id]);
    return res.json({ message: "Adicional com histórico de compras: foi desativado em vez de removido" });
  }
  await db.execute("DELETE FROM saas_adicionais WHERE id = ?", [req.params.id]);
  res.json({ message: "Adicional removido" });
};

exports.obterAssinaturaEmpresa = async (req, res) => {
  const [[a]] = await db.execute("SELECT * FROM assinaturas WHERE empresa_id = ?", [req.params.empresaId]);
  res.json({ assinatura: a || null, estado: await obterStatus(Number(req.params.empresaId)) });
};

// Liberar/estender/cancelar manualmente: { plano_id?, status?, estender_dias?, vence_em? }
exports.definirAssinaturaEmpresa = async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const { plano_id, status, estender_dias, vence_em } = req.body;
  const [[emp]] = await db.execute("SELECT id FROM empresas WHERE id = ?", [empresaId]);
  if (!emp) return res.status(404).json({ message: "Empresa não encontrada" });
  if (status && !["trial", "ativa", "vencida", "cancelada"].includes(status)) return res.status(400).json({ message: "Status inválido" });

  await db.execute("INSERT INTO assinaturas (empresa_id, status) VALUES (?, 'ativa') ON DUPLICATE KEY UPDATE empresa_id = empresa_id", [empresaId]);
  if (plano_id) await db.execute("UPDATE assinaturas SET plano_id = ? WHERE empresa_id = ?", [plano_id, empresaId]);
  if (status) await db.execute("UPDATE assinaturas SET status = ? WHERE empresa_id = ?", [status, empresaId]);
  const dias = parseInt(estender_dias, 10);
  if (dias > 0) {
    const col = status === "trial" ? "trial_ate" : "vence_em";
    await db.execute(
      `UPDATE assinaturas SET ${col} = DATE_ADD(GREATEST(NOW(), COALESCE(${col}, NOW())), INTERVAL ? DAY), ultimo_aviso = NULL WHERE empresa_id = ?`,
      [dias, empresaId]
    );
    if (!status) await db.execute("UPDATE assinaturas SET status = 'ativa' WHERE empresa_id = ? AND status IN ('vencida','cancelada')", [empresaId]);
  }
  if (vence_em) {
    const d = new Date(vence_em);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ message: "Data inválida" });
    await db.execute("UPDATE assinaturas SET vence_em = ?, ultimo_aviso = NULL WHERE empresa_id = ?", [d, empresaId]);
  }
  // Plano gratis nunca vence: sem vencimento e sempre ativa (cancelada continua cancelada).
  const [[atual]] = await db.execute(
    "SELECT p.gratis, a.status FROM assinaturas a LEFT JOIN saas_planos p ON p.id = a.plano_id WHERE a.empresa_id = ?", [empresaId]
  ).catch(() => [[null]]);
  if (atual && atual.gratis && atual.status !== "cancelada") {
    await db.execute("UPDATE assinaturas SET status = 'ativa', vence_em = NULL, trial_ate = NULL WHERE empresa_id = ?", [empresaId]);
  } else {
    // 'ativa' sem vencimento ficaria bloqueada: assume 1 ciclo de 30 dias a partir de agora
    await db.execute("UPDATE assinaturas SET vence_em = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE empresa_id = ? AND status = 'ativa' AND vence_em IS NULL", [empresaId]);
  }
  invalidar(empresaId);
  res.json({ message: "Assinatura atualizada" });
};

exports.obterPlataformaConfig = async (req, res) => {
  const cfg = (await getPlataformaMp()) || {};
  res.json({ access_token: mascarar(cfg.access_token), public_key: cfg.public_key || "", webhook_secret: mascarar(cfg.webhook_secret),
             email_pagador: cfg.email_pagador || "", configurado: !!cfg.access_token });
};

exports.salvarPlataformaConfig = async (req, res) => {
  const atual = (await getPlataformaMp()) || {};
  const novo = { ...atual };
  for (const k of ["access_token", "public_key", "webhook_secret", "email_pagador"]) {
    const v = req.body[k];
    if (typeof v === "string" && v.trim() && !v.endsWith("...")) novo[k] = v.trim();
  }
  await db.execute(
    "INSERT INTO plataforma_configs (chave, config_json) VALUES ('mercadopago', ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)",
    [JSON.stringify(novo)]
  );
  res.json({ message: "Configuração salva" });
};

exports.motivoIndisponivel = motivoIndisponivel;
exports.resolverItem = resolverItem;
