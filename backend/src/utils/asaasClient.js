const axios = require("axios");
const crypto = require("crypto");
const db = require("../../db");

const URLS = {
  producao: "https://api.asaas.com/v3",
  sandbox: "https://api-sandbox.asaas.com/v3",
};

class AsaasError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AsaasError";
    this.status = status || null;
  }
}

function parseJson(v) {
  if (!v) return {};
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return {};
  }
}

/** Config Asaas da empresa (empresa_configs tipo 'asaas'); null se nao houver. */
async function carregarConfig(empresaId) {
  const [[row]] = await db.query(
    "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'asaas'",
    [empresaId]
  );
  return row ? parseJson(row.config_json) : null;
}

/** A empresa cobra o PIX do portal pelo Asaas? (chave definida e opcao ligada) */
function pixAtivo(cfg) {
  return !!(cfg && cfg.api_key && String(cfg.ativo) === "1");
}

/** A empresa cobra o cartao do portal pelo Asaas? (chave definida e opcao de cartao ligada) */
function cartaoAtivo(cfg) {
  return !!(cfg && cfg.api_key && String(cfg.cartao) === "1");
}

const MSG_MIGRATION_068 =
  "O banco ainda não aceita a configuração do Asaas: rode `node migrations/068_empresa_configs_asaas.js` no servidor e reinicie o backend.";

/** O erro do MySQL e' o ENUM empresa_configs.config_type sem 'asaas' (migration 068 pendente)? */
function erroEnumAsaas(err) {
  const msg = String(err?.sqlMessage || err?.message || "");
  return (
    err?.errno === 1265 || err?.errno === 1366 || err?.code === "WARN_DATA_TRUNCATED" || err?.code === "ER_TRUNCATED_WRONG_VALUE" ||
    /config_type/.test(msg)
  );
}

/** Grava o webhook_token da empresa (gerado uma vez) e o devolve. */
async function obterOuCriarWebhookToken(empresaId) {
  const cfg = (await carregarConfig(empresaId)) || {};
  if (cfg.webhook_token) return cfg.webhook_token;
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(
    `INSERT INTO empresa_configs (empresa_id, config_type, config_json)
     VALUES (?, 'asaas', ?)
     ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), atualizado_em = CURRENT_TIMESTAMP`,
    [empresaId, JSON.stringify({ ...cfg, webhook_token: token })]
  );
  return token;
}

/** Empresa dona do webhook_token (rota publica do webhook). */
async function empresaPorWebhookToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  const [rows] = await db.query(
    "SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'asaas' AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.webhook_token')) = ? LIMIT 1",
    [token]
  );
  if (!rows.length) return null;
  return { empresaId: rows[0].empresa_id, cfg: parseJson(rows[0].config_json) };
}

function mensagemDeErro(err) {
  const lista = err.response?.data?.errors;
  if (Array.isArray(lista) && lista.length) {
    return lista.map((e) => e.description).filter(Boolean).join("; ") || "Erro no Asaas";
  }
  if (err.response?.status === 401) return "Chave de API do Asaas inválida";
  return err.message || "Erro no Asaas";
}

async function chamar(cfg, method, path, { data, params } = {}) {
  if (!cfg?.api_key) throw new AsaasError("Chave de API do Asaas não configurada");
  const base = cfg.ambiente === "sandbox" ? URLS.sandbox : URLS.producao;
  try {
    const r = await axios({
      method,
      url: `${base}${path}`,
      data,
      params,
      timeout: 15000,
      headers: {
        access_token: cfg.api_key,
        "Content-Type": "application/json",
        "User-Agent": "hotspot-saas",
      },
    });
    return r.data;
  } catch (err) {
    throw new AsaasError(mensagemDeErro(err), err.response?.status);
  }
}

/** Saldo da conta: serve de teste de credencial. */
const saldo = (cfg) => chamar(cfg, "get", "/finance/balance");

/** Cliente do Asaas pelo CPF/CNPJ; cria (sem notificacoes ao cliente) se nao existir. */
async function obterOuCriarCliente(cfg, { cpf, nome, email }) {
  const lista = await chamar(cfg, "get", "/customers", { params: { cpfCnpj: cpf, limit: 1 } });
  if (lista?.data?.length) return lista.data[0].id;
  const novo = await chamar(cfg, "post", "/customers", {
    data: {
      name: nome || "Cliente Hotspot",
      cpfCnpj: cpf,
      ...(email ? { email } : {}),
      notificationDisabled: true,
    },
  });
  return novo.id;
}

/** Cobranca PIX (valor em reais) e QR Code. */
async function criarCobrancaPix(cfg, { customer, valor, descricao, referencia, vencimento }) {
  const cobranca = await chamar(cfg, "post", "/payments", {
    data: {
      customer,
      billingType: "PIX",
      value: valor,
      dueDate: vencimento,
      description: descricao,
      externalReference: referencia,
    },
  });
  const qr = await chamar(cfg, "get", `/payments/${cobranca.id}/pixQrCode`);
  return { id: cobranca.id, qr_code_base64: qr.encodedImage, copia_cola: qr.payload };
}

/**
 * Cobranca no cartao de credito (a vista). Os dados do cartao seguem direto para o Asaas e nunca sao gravados
 * nem logados. `titular` = { nome, email, cpf, cep, numeroEndereco, telefone } exigidos pelo Asaas.
 */
async function criarCobrancaCartao(cfg, { customer, valor, descricao, referencia, vencimento, cartao, titular, ipCliente }) {
  const cobranca = await chamar(cfg, "post", "/payments", {
    data: {
      customer,
      billingType: "CREDIT_CARD",
      value: valor,
      dueDate: vencimento,
      description: descricao,
      externalReference: referencia,
      creditCard: {
        holderName: cartao.nome,
        number: cartao.numero,
        expiryMonth: cartao.mes,
        expiryYear: cartao.ano,
        ccv: cartao.cvv,
      },
      creditCardHolderInfo: {
        name: titular.nome,
        email: titular.email,
        cpfCnpj: titular.cpf,
        postalCode: titular.cep,
        addressNumber: titular.numeroEndereco,
        phone: titular.telefone,
      },
      remoteIp: ipCliente,
    },
  });
  return { id: cobranca.id, status: cobranca.status };
}

const obterCobranca = (cfg, id) => chamar(cfg, "get", `/payments/${encodeURIComponent(id)}`);

/** Registra o webhook de cobrancas pagas apontando para a URL da empresa. */
const registrarWebhook = (cfg, { url, email, authToken }) =>
  chamar(cfg, "post", "/webhooks", {
    data: {
      name: "Hotspot",
      url,
      email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      sendType: "SEQUENTIALLY",
      events: ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"],
    },
  });

/** Data de hoje (AAAA-MM-DD) no horario de Brasilia, exigida em dueDate. */
function hojeBrasilia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Cobranca paga de verdade (RECEIVED_IN_CASH e' baixa manual do lojista: nao libera acesso). */
const STATUS_PAGO = ["CONFIRMED", "RECEIVED"];

module.exports = {
  AsaasError, MSG_MIGRATION_068, erroEnumAsaas, carregarConfig, pixAtivo, cartaoAtivo, obterOuCriarWebhookToken, empresaPorWebhookToken,
  saldo, obterOuCriarCliente, criarCobrancaPix, criarCobrancaCartao, obterCobranca, registrarWebhook, hojeBrasilia, STATUS_PAGO,
};
