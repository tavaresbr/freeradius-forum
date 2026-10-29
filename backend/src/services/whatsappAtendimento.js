// Atendimento por WhatsApp: recebe o webhook da Evolution (mensagens e status de entrega) e envia respostas.
const crypto = require("crypto");
const axios = require("axios");
const db = require("../../db");
const { normalizarTelefone } = require("./whatsappNotify");
const wpp = require("../controllers/whatsappController");

const MAX_TEXTO = 4000;
const STATUS_ORDEM = ["enviando", "enviada", "entregue", "lida"];

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const ultimos10 = (v) => soDigitos(v).slice(-10);

/** "MESSAGES_UPSERT" e "messages.upsert" viram "messages.upsert". */
const normalizarEvento = (e) => String(e || "").toLowerCase().replace(/_/g, ".");

const TIPOS = {
  conversation: "texto", extendedTextMessage: "texto",
  imageMessage: "imagem", audioMessage: "audio", pttMessage: "audio",
  videoMessage: "video", ptvMessage: "video",
  documentMessage: "documento", documentWithCaptionMessage: "documento",
  stickerMessage: "outro", contactMessage: "outro", locationMessage: "outro",
};
const PREVIA = { imagem: "📷 Imagem", audio: "🎤 Áudio", video: "🎥 Vídeo", documento: "📄 Documento", outro: "Mensagem" };
const IGNORADOS = ["reactionMessage", "protocolMessage", "senderKeyDistributionMessage", "messageContextInfo", "editedMessage"];

/** { telefone, jid } do contato, ou null para grupos/status/canais. */
function resolverContato(key) {
  const remoto = String(key?.remoteJid || "");
  if (!remoto || remoto.endsWith("@g.us") || remoto.startsWith("status@") || remoto.endsWith("@newsletter") || remoto.endsWith("@broadcast")) return null;
  const alt = String(key?.remoteJidAlt || "");
  const base = remoto.endsWith("@s.whatsapp.net") ? remoto : alt.endsWith("@s.whatsapp.net") ? alt : null;
  if (base) {
    const digitos = soDigitos(base.split("@")[0]);
    return { telefone: normalizarTelefone(digitos) || digitos || null, jid: base };
  }
  return { telefone: null, jid: remoto }; // @lid sem numero: so o jid
}

/** Dados de uma mensagem do payload da Evolution, ou null se nao for para guardar. */
function extrairMensagem(data) {
  const key = data?.key;
  if (!key?.id) return null;
  const contato = resolverContato(key);
  if (!contato) return null;
  const msg = data.message || {};
  const chave = Object.keys(msg).find((k) => k !== "messageContextInfo");
  if (!chave || IGNORADOS.includes(chave)) return null;
  const tipo = TIPOS[chave] || "outro";
  const corpo = msg[chave] || {};
  let texto = typeof msg.conversation === "string" ? msg.conversation : (corpo.text || corpo.caption || "");
  if (chave === "documentWithCaptionMessage") {
    const doc = corpo.message?.documentMessage || {};
    texto = doc.caption || "";
  }
  texto = String(texto || "").slice(0, MAX_TEXTO);
  return {
    waId: String(key.id).slice(0, 120),
    fromMe: !!key.fromMe,
    ...contato,
    nome: key.fromMe ? null : String(data.pushName || "").trim().slice(0, 150) || null,
    tipo,
    texto,
    previa: (texto || PREVIA[tipo] || "Mensagem").replace(/\s+/g, " ").slice(0, 200),
    quando: Number(data.messageTimestamp) > 0 ? new Date(Number(data.messageTimestamp) * 1000) : new Date(),
  };
}

async function leadPorTelefone(empresaId, telefone) {
  const fim = ultimos10(telefone);
  if (fim.length < 10) return null;
  const [rows] = await db.query(
    `SELECT id, nome FROM leads WHERE empresa_id = ? AND telefone IS NOT NULL AND telefone <> ''
       AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10) = ? ORDER BY id LIMIT 1`,
    [empresaId, fim]
  );
  return rows[0] || null;
}

async function obterOuCriarConversa(empresaId, m) {
  const [[existente]] = await db.query("SELECT id FROM whatsapp_conversas WHERE empresa_id = ? AND jid = ?", [empresaId, m.jid]);
  if (existente) return existente.id;
  const lead = m.telefone ? await leadPorTelefone(empresaId, m.telefone) : null;
  const [r] = await db.query(
    `INSERT INTO whatsapp_conversas (empresa_id, jid, telefone, nome, lead_id, ultima_msg_em)
     VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [empresaId, m.jid, m.telefone, m.nome || lead?.nome || null, lead?.id || null, m.quando]
  );
  return r.insertId;
}

/** Quem responde "SAIR" sai das promocoes (opt-out), como pede o rodape da mensagem. */
async function aplicarOptOut(empresaId, m) {
  if (m.fromMe || m.tipo !== "texto" || !m.telefone) return;
  if (m.texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "") !== "sair") return;
  try {
    await db.query(
      `UPDATE leads SET whatsapp_optout = 1, whatsapp_optout_em = NOW()
        WHERE empresa_id = ? AND whatsapp_optout = 0 AND telefone IS NOT NULL
          AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10) = ?`,
      [empresaId, ultimos10(m.telefone)]
    );
  } catch (err) {
    console.warn("[atendimento] opt-out SAIR nao aplicado:", err.message);
  }
}

async function registrarMensagem(empresaId, data) {
  const m = extrairMensagem(data);
  if (!m) return { ignorada: true };
  const conversaId = await obterOuCriarConversa(empresaId, m);
  const [ins] = await db.query(
    `INSERT IGNORE INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, conversaId, m.waId, m.fromMe ? "out" : "in", m.tipo, m.texto || null, m.fromMe ? "enviada" : "entregue", m.quando]
  );
  if (!ins.affectedRows) return { duplicada: true, conversaId };
  // Mensagem do cliente reabre a conversa e conta como nao lida; resposta feita pelo celular nao.
  await db.query(
    `UPDATE whatsapp_conversas SET ultima_msg_em = ?, ultima_msg_previa = ?,
            nao_lidas = nao_lidas + ?, status = IF(?, 'aberta', status),
            nome = COALESCE(NULLIF(nome, ''), ?)
      WHERE id = ? AND empresa_id = ?`,
    [m.quando, m.previa, m.fromMe ? 0 : 1, m.fromMe ? 0 : 1, m.nome, conversaId, empresaId]
  );
  await aplicarOptOut(empresaId, m);
  return { conversaId };
}

const STATUS_EVOLUTION = { SERVER_ACK: "enviada", DELIVERY_ACK: "entregue", READ: "lida", PLAYED: "lida" };

async function atualizarStatus(empresaId, item) {
  const waId = item?.keyId || item?.key?.id;
  const novo = STATUS_EVOLUTION[String(item?.status || "").toUpperCase()];
  if (!waId || !novo) return;
  // So avanca (enviada -> entregue -> lida), nunca regride.
  await db.query(
    `UPDATE whatsapp_mensagens SET status = ?
      WHERE empresa_id = ? AND wa_id = ? AND direcao = 'out'
        AND FIELD(status, ${STATUS_ORDEM.map(() => "?").join(",")}) < FIELD(?, ${STATUS_ORDEM.map(() => "?").join(",")})`,
    [novo, empresaId, String(waId), ...STATUS_ORDEM, novo, ...STATUS_ORDEM]
  );
}

/** Processa o corpo do webhook da Evolution (empresa ja validada pelo token da URL). */
async function processarWebhook(empresaId, corpo) {
  const evento = normalizarEvento(corpo?.event);
  const itens = Array.isArray(corpo?.data) ? corpo.data : corpo?.data ? [corpo.data] : [];
  if (evento === "messages.upsert") {
    for (const d of itens) await registrarMensagem(empresaId, d);
  } else if (evento === "messages.update") {
    for (const d of itens) await atualizarStatus(empresaId, d);
  }
}

// --- Token do webhook (por empresa, guardado em empresa_configs 'whatsapp') ---

async function obterOuCriarWebhookToken(empresaId) {
  const [[linha]] = await db.query("SELECT id, config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'", [empresaId]);
  const cfg = linha ? (typeof linha.config_json === "string" ? JSON.parse(linha.config_json) : linha.config_json) || {} : {};
  if (cfg.webhook_token) return cfg.webhook_token;
  cfg.webhook_token = crypto.randomBytes(24).toString("hex");
  if (linha) {
    await db.query("UPDATE empresa_configs SET config_json = ? WHERE id = ?", [JSON.stringify(cfg), linha.id]);
  } else {
    await db.query("INSERT INTO empresa_configs (empresa_id, config_type, config_json) VALUES (?, 'whatsapp', ?)", [empresaId, JSON.stringify(cfg)]);
  }
  return cfg.webhook_token;
}

/** { empresaId, instancia } dono do token, ou null. */
async function empresaPorWebhookToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  const [[linha]] = await db.query(
    `SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp'
       AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.webhook_token')) = ? LIMIT 1`,
    [token]
  );
  if (!linha) return null;
  const cfg = typeof linha.config_json === "string" ? JSON.parse(linha.config_json) : linha.config_json || {};
  return { empresaId: linha.empresa_id, instancia: cfg.instance_name || `empresa_${linha.empresa_id}` };
}

const EVENTOS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"];
const baseWebhook = () => (process.env.EVOLUTION_WEBHOOK_BASE || "http://host.docker.internal:3001").replace(/\/+$/, "");

async function ativarWebhook(empresaId) {
  const evo = await wpp.getEvolutionConfig(empresaId);
  if (!evo.apiKey) throw new Error("WhatsApp sem chave de API configurada");
  const token = await obterOuCriarWebhookToken(empresaId);
  const url = `${baseWebhook()}/api/whatsapp-webhook/${token}`;
  await axios.post(
    `${evo.apiUrl}/webhook/set/${evo.instanceName}`,
    { webhook: { enabled: true, url, byEvents: false, base64: false, events: EVENTOS } },
    { headers: { apikey: evo.apiKey, "Content-Type": "application/json" }, timeout: 15000 }
  );
  return { ativo: true };
}

async function statusWebhook(empresaId) {
  const evo = await wpp.getEvolutionConfig(empresaId);
  if (!evo.apiKey) return { ativo: false };
  const token = await obterOuCriarWebhookToken(empresaId);
  try {
    const r = await axios.get(`${evo.apiUrl}/webhook/find/${evo.instanceName}`, { headers: { apikey: evo.apiKey }, timeout: 10000 });
    const w = r.data?.webhook || r.data || {};
    return { ativo: !!w.enabled && String(w.url || "").includes(token) };
  } catch {
    return { ativo: false };
  }
}

// --- Envio ---

/**
 * Envia texto pela instancia da empresa e grava a mensagem. A linha nasce "enviando"; o webhook
 * (fromMe) pode gravar o mesmo wa_id antes de a resposta da Evolution chegar — nesse caso a linha
 * temporaria e' descartada (UNIQUE empresa+wa_id).
 */
async function enviarTexto(empresaId, adminId, conversa, texto) {
  const evo = await wpp.getEvolutionConfig(empresaId);
  if (!evo.apiKey) throw Object.assign(new Error("WhatsApp sem chave de API configurada"), { status: 400 });
  const temp = `tmp_${crypto.randomUUID()}`;
  const [ins] = await db.query(
    `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, admin_id)
     VALUES (?, ?, ?, 'out', 'texto', ?, 'enviando', ?)`,
    [empresaId, conversa.id, temp, texto, adminId || null]
  );
  const id = ins.insertId;
  const numero = conversa.telefone ? wpp.formatarNumeroComNonoDigito(conversa.telefone) : conversa.jid;
  try {
    const r = await axios.post(
      `${evo.apiUrl}/message/sendText/${evo.instanceName}`,
      { number: numero, text: texto },
      { headers: { apikey: evo.apiKey, "Content-Type": "application/json" }, timeout: 20000 }
    );
    const waId = r.data?.key?.id;
    if (waId) {
      try {
        await db.query("UPDATE whatsapp_mensagens SET wa_id = ?, status = 'enviada' WHERE id = ? AND empresa_id = ?", [String(waId).slice(0, 120), id, empresaId]);
      } catch (err) {
        if (err.code !== "ER_DUP_ENTRY") throw err;
        await db.query("DELETE FROM whatsapp_mensagens WHERE id = ? AND empresa_id = ?", [id, empresaId]);
        return { id: null, duplicada: true };
      }
    } else {
      await db.query("UPDATE whatsapp_mensagens SET status = 'enviada' WHERE id = ? AND empresa_id = ?", [id, empresaId]);
    }
    await db.query(
      "UPDATE whatsapp_conversas SET ultima_msg_em = NOW(), ultima_msg_previa = ?, nao_lidas = 0 WHERE id = ? AND empresa_id = ?",
      [texto.replace(/\s+/g, " ").slice(0, 200), conversa.id, empresaId]
    );
    return { id };
  } catch (err) {
    const motivo = String(err?.response?.data?.response?.message || err?.response?.data?.message || err.message || "erro").slice(0, 250);
    await db.query("UPDATE whatsapp_mensagens SET status = 'erro', erro = ? WHERE id = ? AND empresa_id = ?", [motivo, id, empresaId]);
    throw Object.assign(new Error("Não foi possível enviar a mensagem. Confira se o WhatsApp está conectado."), { status: 502, mensagemId: id });
  }
}

module.exports = {
  MAX_TEXTO, extrairMensagem, resolverContato, normalizarEvento, processarWebhook, registrarMensagem, atualizarStatus,
  obterOuCriarWebhookToken, empresaPorWebhookToken, ativarWebhook, statusWebhook, enviarTexto,
};
