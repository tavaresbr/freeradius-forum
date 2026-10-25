const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const db = require("../../db");
const { validarAssinaturaWebhook } = require("../utils/mpSignature");
const { obterStatus, invalidar } = require("../utils/assinatura");

// ---------- helpers ----------

async function getPlataformaMp() {
  const [[row]] = await db.execute("SELECT config_json FROM plataforma_configs WHERE chave = 'mercadopago'");
  if (!row) return null;
  return typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
}

const mascarar = (v) => (v ? `${String(v).slice(0, 8)}...` : "");

/** Aplica um pagamento aprovado: marca a cobranca (atomico) e estende a assinatura. */
async function ativarPorCobranca(cobranca) {
  // Idempotencia: so quem transiciona aguardando->aprovada estende o periodo.
  const [r] = await db.execute(
    "UPDATE assinatura_cobrancas SET status = 'aprovada', pago_em = NOW() WHERE id = ? AND status <> 'aprovada'",
    [cobranca.id]
  );
  if (r.affectedRows !== 1) return false;

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
  const planoId = parseInt(b.plano_id, 10);

  if (cardDigits.length < 13 || cardDigits.length > 19) return res.status(400).json({ message: "Número do cartão inválido." });
  if (cvv.length < 3 || cvv.length > 4) return res.status(400).json({ message: "CVV inválido." });
  if (nome.length < 2) return res.status(400).json({ message: "Nome no cartão obrigatório." });
  if (cpf.length !== 11) return res.status(400).json({ message: "CPF do titular inválido." });
  if (!mes || mes < 1 || mes > 12) return res.status(400).json({ message: "Mês de validade inválido." });
  if (!ano || ano < new Date().getFullYear() || ano > 2099) return res.status(400).json({ message: "Ano de validade inválido." });
  if (!b.device_session_id) return res.status(400).json({ message: "Ambiente seguro não carregado. Recarregue a página." });

  let cobrancaId = null;
  try {
    const [[plano]] = await db.execute("SELECT id, nome, valor FROM saas_planos WHERE id = ? AND ativo = 1", [planoId]);
    if (!plano) return res.status(404).json({ message: "Plano não encontrado." });

    const cfg = await getPlataformaMp();
    if (!cfg?.access_token || !cfg?.public_key) return res.status(503).json({ message: "Pagamento indisponível no momento. Fale com o suporte." });

    const empresaId = req.empresa_id;
    const [[empresa]] = await db.execute("SELECT email FROM empresas WHERE id = ?", [empresaId]);
    const valor = Number(plano.valor);

    const [ins] = await db.execute(
      "INSERT INTO assinatura_cobrancas (empresa_id, plano_id, valor, metodo, status) VALUES (?, ?, ?, 'cartao', 'aguardando')",
      [empresaId, plano.id, plano.valor]
    );
    cobrancaId = ins.insertId;

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

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const { data } = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: valor,
        token,
        description: `Assinatura ${plano.nome}`,
        installments: 1,
        payment_method_id: bin.payment_method_id,
        issuer_id: bin.issuer_id || undefined,
        statement_descriptor: "APEXTELECOM",
        external_reference: `ass_${cobrancaId}_emp_${empresaId}`,
        notification_url: `${proto}://${host}/api/assinatura/webhook`,
        capture: true,
        binary_mode: false,
        metadata: { device_session_id: b.device_session_id },
        payer: { email: (empresa?.email || cfg.email_pagador || "").trim() },
        additional_info: { items: [{ id: String(plano.id), title: `Assinatura ${plano.nome}`, category_id: "services", quantity: 1, unit_price: valor }] },
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
      "SELECT id, nome, descricao, valor, ciclo_dias, max_equipamentos, max_admins FROM saas_planos WHERE ativo = 1 ORDER BY ordem, id"
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
    const [[ad]] = await db.execute("SELECT COUNT(*) AS n FROM admins WHERE empresa_id = ?", [req.empresa_id]);
    res.json({ ...st, uso: { equipamentos: eq.n, admins: ad.n } });
  } catch (err) {
    console.error("Erro ao obter assinatura:", err.message);
    res.status(500).json({ message: "Erro ao obter assinatura" });
  }
};

exports.criarCobranca = async (req, res) => {
  try {
    const planoId = parseInt(req.body.plano_id, 10);
    const [[plano]] = await db.execute("SELECT id, nome, valor FROM saas_planos WHERE id = ? AND ativo = 1", [planoId]);
    if (!plano) return res.status(404).json({ message: "Plano não encontrado." });

    const cfg = await getPlataformaMp();
    if (!cfg?.access_token) return res.status(503).json({ message: "Pagamento indisponível no momento. Fale com o suporte." });

    const empresaId = req.empresa_id;
    const [[empresa]] = await db.execute("SELECT email FROM empresas WHERE id = ?", [empresaId]);

    const [ins] = await db.execute(
      "INSERT INTO assinatura_cobrancas (empresa_id, plano_id, valor, metodo, status) VALUES (?, ?, ?, 'pix', 'aguardando')",
      [empresaId, plano.id, plano.valor]
    );
    const cobrancaId = ins.insertId;

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const { data } = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: Number(plano.valor),
        description: `Assinatura ${plano.nome}`,
        payment_method_id: "pix",
        external_reference: `ass_${cobrancaId}_emp_${empresaId}`,
        notification_url: `${proto}://${host}/api/assinatura/webhook`,
        payer: { email: (cfg.email_pagador || empresa?.email || "").trim() },
      },
      { headers: { Authorization: `Bearer ${cfg.access_token}`, "Content-Type": "application/json", "X-Idempotency-Key": uuidv4() } }
    );
    const td = data.point_of_interaction.transaction_data;
    await db.execute(
      "UPDATE assinatura_cobrancas SET mp_pagamento_id = ?, copia_cola = ?, qr_code_base64 = ? WHERE id = ?",
      [String(data.id), td.qr_code, td.qr_code_base64, cobrancaId]
    );
    res.status(201).json({ id: cobrancaId, valor: plano.valor, copia_cola: td.qr_code, qr_code_base64: td.qr_code_base64 });
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
    Math.max(0, Number(b.valor) || 0),
    Math.max(1, parseInt(b.ciclo_dias, 10) || 30),
    nulo(b.max_equipamentos),
    nulo(b.max_admins),
    b.ativo === false || b.ativo === 0 ? 0 : 1,
    parseInt(b.ordem, 10) || 0,
  ];
}

exports.criarPlano = async (req, res) => {
  const d = dadosPlano(req.body);
  if (!d[0]) return res.status(400).json({ message: "Nome é obrigatório" });
  const [r] = await db.execute(
    "INSERT INTO saas_planos (nome, descricao, valor, ciclo_dias, max_equipamentos, max_admins, ativo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", d);
  invalidar();
  res.status(201).json({ id: r.insertId });
};

exports.atualizarPlano = async (req, res) => {
  const d = dadosPlano(req.body);
  if (!d[0]) return res.status(400).json({ message: "Nome é obrigatório" });
  await db.execute(
    "UPDATE saas_planos SET nome=?, descricao=?, valor=?, ciclo_dias=?, max_equipamentos=?, max_admins=?, ativo=?, ordem=? WHERE id=?",
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
  // 'ativa' sem vencimento ficaria bloqueada: assume 1 ciclo de 30 dias a partir de agora
  await db.execute("UPDATE assinaturas SET vence_em = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE empresa_id = ? AND status = 'ativa' AND vence_em IS NULL", [empresaId]);
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
