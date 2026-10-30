const db = require("../../db");
const crypto = require("crypto");
const asaas = require("../utils/asaasClient");
const { baseUrlPublica } = require("../utils/baseUrl");
const { confirmarPagamentoAsaas } = require("../services/asaasPagamento");

const iguais = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// POST /api/pagamentos/asaas/webhook/:token  (publico)
// O token (48 hex, por empresa) identifica a empresa; o corpo NAO e' confiavel: a cobranca e' relida no Asaas.
// Responde 200 mesmo quando ignora, para o Asaas nao pausar a fila de webhooks por erro nosso.
exports.webhook = async (req, res) => {
  try {
    const dono = await asaas.empresaPorWebhookToken(req.params.token);
    if (!dono) return res.sendStatus(404);

    // Cabecalho configurado como authToken no registro do webhook (se vier, tem que bater).
    const header = req.headers["asaas-access-token"];
    if (header !== undefined && !iguais(header, req.params.token)) return res.sendStatus(401);

    const evento = req.body?.event;
    const asaasId = req.body?.payment?.id;
    if (!["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(evento) || typeof asaasId !== "string") {
      return res.sendStatus(200);
    }

    const [[pag]] = await db.query(
      "SELECT id FROM pagamentos WHERE mp_pagamento_id = ? AND empresa_id = ? AND gateway = 'asaas'",
      [asaasId, dono.empresaId]
    );
    if (!pag) {
      console.log(`[webhook Asaas] cobranca desconhecida (empresa=${dono.empresaId}), ignorando`);
      return res.sendStatus(200);
    }
    const r = await confirmarPagamentoAsaas(pag.id);
    console.log(`[webhook Asaas] pag=${pag.id} empresa=${dono.empresaId} evento=${evento} => ${r}`);
    res.sendStatus(200);
  } catch (err) {
    console.error("[webhook Asaas] erro:", err.message);
    res.sendStatus(500); // o Asaas tenta de novo
  }
};

// POST /api/empresa-config/asaas/testar
exports.testar = async (req, res) => {
  try {
    const cfg = await asaas.carregarConfig(req.empresa_id);
    if (!cfg?.api_key) return res.status(400).json({ message: "Chave de API do Asaas não configurada" });
    const s = await asaas.saldo(cfg);
    res.json({ success: true, saldo: s?.balance ?? null, ambiente: cfg.ambiente === "sandbox" ? "sandbox" : "producao" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Falha na comunicação com o Asaas" });
  }
};

// GET /api/empresa-config/asaas/webhook  -> URL que o Asaas deve chamar
exports.urlWebhook = async (req, res) => {
  try {
    const token = await asaas.obterOuCriarWebhookToken(req.empresa_id);
    res.json({ url: `${baseUrlPublica(req)}/api/pagamentos/asaas/webhook/${token}` });
  } catch (err) {
    console.error("Erro ao obter URL do webhook Asaas:", err.message);
    if (asaas.erroEnumAsaas(err)) return res.status(503).json({ message: asaas.MSG_MIGRATION_068 });
    res.status(500).json({ message: "Erro ao obter a URL do webhook" });
  }
};

// POST /api/empresa-config/asaas/webhook/ativar  -> registra o webhook na conta Asaas da empresa
exports.ativarWebhook = async (req, res) => {
  try {
    const cfg = await asaas.carregarConfig(req.empresa_id);
    if (!cfg?.api_key) return res.status(400).json({ message: "Salve a chave de API do Asaas antes de ativar o webhook" });
    const token = await asaas.obterOuCriarWebhookToken(req.empresa_id);
    const url = `${baseUrlPublica(req)}/api/pagamentos/asaas/webhook/${token}`;
    await asaas.registrarWebhook(cfg, { url, email: req.user?.email || "contato@localhost.invalid", authToken: token });
    res.json({ success: true, url });
  } catch (err) {
    res.status(400).json({ message: err.message || "Não foi possível registrar o webhook no Asaas" });
  }
};
