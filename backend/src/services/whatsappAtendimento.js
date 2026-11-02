// Atendimento por WhatsApp: recebe o webhook da Evolution (mensagens e status de entrega) e envia respostas.
const crypto = require("crypto");
const axios = require("axios");
const db = require("../../db");
const naoPerturbe = require("../utils/naoPerturbe");
const { normalizarTelefone } = require("./whatsappNotify");
const wpp = require("../controllers/whatsappController");
const midiaUtil = require("../utils/whatsappMidia");
const { exprTelefoneFim10 } = require("../utils/telefoneBusca");
const { normalizarHost } = require("../utils/entradaSegura");
const { temColuna } = require("../utils/schemaCache");

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

/** "📍 Localizacao: nome — endereco" + link do mapa (so com coordenadas validas). */
function textoLocalizacao(loc) {
  const lat = Number(loc?.degreesLatitude), lng = Number(loc?.degreesLongitude);
  const nome = [loc?.name, loc?.address].filter(Boolean).join(" — ");
  const link = Number.isFinite(lat) && Number.isFinite(lng) ? `\nhttps://maps.google.com/?q=${lat},${lng}` : "";
  return `📍 Localização${nome ? `: ${nome}` : ""}${link}`;
}

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
  if (chave === "locationMessage") texto = textoLocalizacao(corpo);
  if (chave === "contactMessage") texto = `👤 Contato: ${corpo.displayName || ""}`.trim();
  texto = String(texto || "").slice(0, MAX_TEXTO);
  // Citacao (resposta a uma mensagem anterior)
  const ctx = corpo.contextInfo || data.contextInfo || msg.contextInfo || {};
  const respostaA = typeof ctx.stanzaId === "string" && ctx.stanzaId ? ctx.stanzaId.slice(0, 120) : null;
  const citada = ctx.quotedMessage || {};
  const respostaPrevia = respostaA
    ? String(citada.conversation || citada.extendedTextMessage?.text || citada.imageMessage?.caption || citada.videoMessage?.caption || citada.documentMessage?.caption
      || (citada.imageMessage ? "📷 Imagem" : citada.audioMessage ? "🎤 Áudio" : citada.videoMessage ? "🎥 Vídeo" : citada.documentMessage ? "📄 Documento" : "Mensagem")).replace(/\s+/g, " ").slice(0, 200)
    : null;
  // Midia: tipo/nome do arquivo informados no payload (so guardados se o tipo for aceito)
  let midia = null;
  if (["imagem", "audio", "video", "documento"].includes(tipo)) {
    const arq = chave === "documentWithCaptionMessage" ? corpo.message?.documentMessage || {} : corpo;
    const mime = midiaUtil.mimeAceito(arq.mimetype);
    if (mime) midia = { mime, nome: midiaUtil.nomeSeguro(arq.fileName) };
  }
  return {
    waId: String(key.id).slice(0, 120),
    midia,
    respostaA,
    respostaPrevia,
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
  const expr = await exprTelefoneFim10();
  const [rows] = await db.query(
    `SELECT id, nome FROM leads WHERE empresa_id = ? AND telefone IS NOT NULL AND telefone <> ''
       AND ${expr} = ? ORDER BY id LIMIT 1`,
    [empresaId, fim]
  );
  return rows[0] || null;
}

async function obterOuCriarConversa(empresaId, m, numeroId = 0) {
  const comNumero = numeroId > 0 || await temColuna("whatsapp_conversas", "numero_id");
  const [[existente]] = comNumero
    ? await db.query("SELECT id FROM whatsapp_conversas WHERE empresa_id = ? AND numero_id = ? AND jid = ?", [empresaId, numeroId, m.jid])
    : await db.query("SELECT id FROM whatsapp_conversas WHERE empresa_id = ? AND jid = ?", [empresaId, m.jid]);
  if (existente) return existente.id;
  const lead = m.telefone ? await leadPorTelefone(empresaId, m.telefone) : null;
  const [r] = comNumero
    ? await db.query(
      `INSERT INTO whatsapp_conversas (empresa_id, numero_id, jid, telefone, nome, lead_id, ultima_msg_em)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [empresaId, numeroId, m.jid, m.telefone, m.nome || lead?.nome || null, lead?.id || null, m.quando])
    : await db.query(
      `INSERT INTO whatsapp_conversas (empresa_id, jid, telefone, nome, lead_id, ultima_msg_em)
       VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [empresaId, m.jid, m.telefone, m.nome || lead?.nome || null, lead?.id || null, m.quando]);
  return r.insertId;
}

/** Quem responde "SAIR" sai das promocoes (opt-out), como pede o rodape da mensagem. */
async function aplicarOptOut(empresaId, m) {
  if (m.fromMe || m.tipo !== "texto" || !m.telefone) return;
  if (m.texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "") !== "sair") return;
  try {
    await naoPerturbe.adicionar(empresaId, m.telefone, { motivo: "Respondeu SAIR", origem: "sair" });
    const expr = await exprTelefoneFim10();
    await db.query(
      `UPDATE leads SET whatsapp_optout = 1, whatsapp_optout_em = NOW()
        WHERE empresa_id = ? AND whatsapp_optout = 0 AND telefone IS NOT NULL
          AND ${expr} = ?`,
      [empresaId, ultimos10(m.telefone)]
    );
  } catch (err) {
    console.warn("[atendimento] opt-out SAIR nao aplicado:", err.message);
  }
}

async function registrarMensagem(empresaId, data, numeroId = 0) {
  const m = extrairMensagem(data);
  if (!m) return { ignorada: true };
  const conversaId = await obterOuCriarConversa(empresaId, m, numeroId);
  const [ins] = await db.query(
    `INSERT IGNORE INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, criado_em, midia_mime, midia_nome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, conversaId, m.waId, m.fromMe ? "out" : "in", m.tipo, m.texto || null, m.fromMe ? "enviada" : "entregue", m.quando,
      m.midia?.mime || null, m.midia?.nome || null]
  );
  if (!ins.affectedRows) return { duplicada: true, conversaId };
  if (m.respostaA && await temColuna("whatsapp_mensagens", "resposta_a_wa_id")) {
    await db.query("UPDATE whatsapp_mensagens SET resposta_a_wa_id = ?, resposta_previa = ? WHERE id = ? AND empresa_id = ?", [m.respostaA, m.respostaPrevia, ins.insertId, empresaId]);
  }
  // Resposta a pesquisa de satisfacao ("1" a "5"): grava a nota sem reabrir a conversa nem contar como nao lida.
  if (!m.fromMe) {
    let nota = false;
    try { nota = await require("./whatsappSatisfacao").capturarNota(empresaId, conversaId, m); }
    catch (err) { console.warn("[atendimento] nota nao gravada:", err.message); }
    if (nota) {
      await db.query("UPDATE whatsapp_conversas SET ultima_msg_em = ?, ultima_msg_previa = ? WHERE id = ? AND empresa_id = ?", [m.quando, m.previa, conversaId, empresaId]);
      // Pos-compra: nota alta -> link de avaliacao; nota baixa -> alerta ao gestor (desligado por padrao, em segundo plano)
      require("./whatsappPosCompra").aoReceberNota(empresaId, conversaId, ins.insertId).catch(() => {});
      return { conversaId, nota: true };
    }
  }
  // Mensagem do cliente reabre a conversa e conta como nao lida; resposta feita pelo celular nao.
  await db.query(
    `UPDATE whatsapp_conversas SET ultima_msg_em = ?, ultima_msg_previa = ?,
            nao_lidas = nao_lidas + ?, status = IF(?, 'aberta', status),
            nome = COALESCE(NULLIF(nome, ''), ?)
      WHERE id = ? AND empresa_id = ?`,
    [m.quando, m.previa, m.fromMe ? 0 : 1, m.fromMe ? 0 : 1, m.nome, conversaId, empresaId]
  );
  await aplicarOptOut(empresaId, m);
  // Fase 1 de varios numeros: chatbot e resposta automatica so atendem o numero PRINCIPAL.
  if (!m.fromMe && !numeroId) {
    // Chatbot de menu e, se ele nao tratou a mensagem, resposta automatica (boas-vindas / fora do horario):
    // em segundo plano, nunca atrapalha o webhook.
    require("./whatsappChatbot").processar(empresaId, conversaId, m)
      .catch((err) => { console.warn("[atendimento] chatbot falhou:", err.message); return { tratada: false }; })
      .then((r) => (r && r.tratada ? null : require("./whatsappAutomacao").responderAutomatico(empresaId, conversaId, m)))
      .catch((err) => console.warn("[atendimento] resposta automatica falhou:", err.message));
  }
  if (m.midia) {
    // Falha ao baixar nao perde a mensagem: o painel tenta de novo ao abrir a midia.
    try { await baixarMidia(empresaId, { id: ins.insertId, wa_id: m.waId, midia_mime: m.midia.mime }); }
    catch (err) { console.warn("[atendimento] midia nao baixada:", err?.response?.status || err.message); }
  }
  return { conversaId };
}

/** numero_id da conversa (0 = principal). Sem a coluna (migration 075) tudo e' o principal. */
async function numeroDaConversa(empresaId, conversaId) {
  if (!(await temColuna("whatsapp_conversas", "numero_id"))) return 0;
  const [[c]] = await db.query("SELECT numero_id FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]);
  return c ? Number(c.numero_id) || 0 : 0;
}

async function numeroDaMensagem(empresaId, mensagemId) {
  if (!(await temColuna("whatsapp_conversas", "numero_id"))) return 0;
  const [[c]] = await db.query(
    `SELECT c.numero_id FROM whatsapp_mensagens m JOIN whatsapp_conversas c ON c.id = m.conversa_id AND c.empresa_id = m.empresa_id
      WHERE m.id = ? AND m.empresa_id = ?`, [mensagemId, empresaId]);
  return c ? Number(c.numero_id) || 0 : 0;
}

/**
 * Baixa a midia de uma mensagem recebida pela Evolution (base64) e grava em disco.
 * @param {{id, wa_id, midia_mime}} msg linha de whatsapp_mensagens (da empresa)
 * @returns {Promise<string|null>} caminho relativo gravado
 */
async function baixarMidia(empresaId, msg) {
  const evo = await wpp.getEvolutionConfig(empresaId, await numeroDaMensagem(empresaId, msg.id));
  if (!evo.apiKey) throw new Error("WhatsApp sem chave de API configurada");
  const r = await axios.post(
    `${evo.apiUrl}/chat/getBase64FromMediaMessage/${evo.instanceName}`,
    { message: { key: { id: msg.wa_id } } },
    { headers: { apikey: evo.apiKey, "Content-Type": "application/json" }, timeout: 60000, maxContentLength: midiaUtil.MAX_BYTES * 2, maxBodyLength: midiaUtil.MAX_BYTES * 2 }
  );
  const b64 = String(r.data?.base64 || "").replace(/^data:[^,]*,/, "");
  if (!b64) throw new Error("Evolution nao devolveu a midia");
  const buf = Buffer.from(b64, "base64");
  const arq = midiaUtil.validarArquivo(buf, r.data?.mimetype || msg.midia_mime, null);
  const rel = await midiaUtil.salvarArquivo(empresaId, buf, arq.ext);
  await db.query(
    "UPDATE whatsapp_mensagens SET midia_path = ?, midia_mime = ? WHERE id = ? AND empresa_id = ?",
    [rel, arq.mime, msg.id, empresaId]
  );
  return rel;
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
async function processarWebhook(empresaId, corpo, numeroId = 0) {
  const evento = normalizarEvento(corpo?.event);
  const itens = Array.isArray(corpo?.data) ? corpo.data : corpo?.data ? [corpo.data] : [];
  if (evento === "messages.upsert") {
    for (const d of itens) await registrarMensagem(empresaId, d, numeroId);
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
/**
 * URL base que a Evolution (container Docker) usa para chamar este backend. EVOLUTION_WEBHOOK_BASE manda; senao o
 * dominio publico (SYSTEM_DOMAIN, via nginx: nao depende da rede Docker). `host.docker.internal` so como ultimo recurso:
 * em Linux ele nao resolve dentro do container sem `extra_hosts`.
 */
const baseWebhook = () => {
  const manual = String(process.env.EVOLUTION_WEBHOOK_BASE || "").trim();
  if (manual) return manual.replace(/\/+$/, "");
  const host = normalizarHost(process.env.SYSTEM_DOMAIN || "");
  return host ? `https://${host}` : "http://host.docker.internal:3001";
};

// Ultimo evento recebido por empresa (memoria do processo): ajuda a ver se a Evolution esta chegando.
const ultimoEvento = new Map();
const registrarEvento = (empresaId, evento) => ultimoEvento.set(empresaId, { quando: new Date(), evento: String(evento || "").slice(0, 60) });

async function ativarWebhook(empresaId, numeroId = 0) {
  const evo = await wpp.getEvolutionConfig(empresaId, numeroId);
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

async function statusWebhook(empresaId, numeroId = 0) {
  const evo = await wpp.getEvolutionConfig(empresaId, numeroId);
  const ev = ultimoEvento.get(empresaId);
  const base = { ativo: false, ultimo_evento_em: ev?.quando || null };
  if (!evo.apiKey) return base;
  const token = await obterOuCriarWebhookToken(empresaId);
  try {
    const r = await axios.get(`${evo.apiUrl}/webhook/find/${evo.instanceName}`, { headers: { apikey: evo.apiKey }, timeout: 10000 });
    const w = r.data?.webhook || r.data || {};
    const url = String(w.url || "");
    // Registrado com a URL de antes (outro host) = a Evolution nao esta chegando aqui: precisa registrar de novo.
    const esperada = `${baseWebhook()}/api/whatsapp-webhook/${token}`;
    let host = "";
    try { host = new URL(url).host; } catch { /* sem URL */ }
    return { ...base, ativo: !!w.enabled && url === esperada, url_host: host };
  } catch {
    return base;
  }
}

const garantidoEm = new Map();
/** Registra o webhook se faltar ou estiver com URL antiga (no maximo 1 tentativa por 10 min por empresa). */
async function garantirWebhook(empresaId) {
  const st = await statusWebhook(empresaId);
  if (st.ativo) return st;
  if (Date.now() - (garantidoEm.get(empresaId) || 0) < 10 * 60 * 1000) return st;
  garantidoEm.set(empresaId, Date.now());
  try { await ativarWebhook(empresaId); return { ...st, ativo: true, reativado: true }; }
  catch (err) { console.warn("[atendimento] webhook nao reativado:", err?.response?.data || err.message); return st; }
}

// --- Envio ---

/**
 * Envia texto ou midia pela instancia da empresa e grava a mensagem. A linha nasce "enviando"; o webhook
 * (fromMe) pode gravar o mesmo wa_id antes de a resposta da Evolution chegar — nesse caso a linha
 * temporaria e' descartada (UNIQUE empresa+wa_id).
 * @param {{tipo?: string, texto?: string, midia?: {buffer: Buffer, mime: string, ext: string, nome: string|null}, citada?: {waId: string, fromMe: boolean, texto?: string}, automatica?: boolean, especial?: {endpoint: string, corpo: object}}} conteudo
 * `especial` = envio por outro endpoint da Evolution (sendLocation, sendContact); `texto` e' o que fica gravado.
 */
async function enviarMensagem(empresaId, adminId, conversa, { tipo = "texto", texto = "", midia = null, citada = null, especial = null, automatica = false } = {}) {
  // Responde SEMPRE pelo numero da conversa (quem chamou pode ter carregado so alguns campos da conversa).
  const numeroId = conversa.numero_id !== undefined ? Number(conversa.numero_id) || 0 : await numeroDaConversa(empresaId, conversa.id);
  let evo;
  try { evo = await wpp.getEvolutionConfig(empresaId, numeroId); }
  catch (err) {
    if (err.code === "NUMERO_WHATSAPP_INVALIDO") throw Object.assign(new Error("O número de WhatsApp desta conversa foi removido. Não dá para responder por ele."), { status: 400 });
    throw err;
  }
  if (!evo.apiKey) throw Object.assign(new Error("WhatsApp sem chave de API configurada"), { status: 400 });
  const temp = `tmp_${crypto.randomUUID()}`;
  const rel = midia ? await midiaUtil.salvarArquivo(empresaId, midia.buffer, midia.ext) : null;
  const [ins] = await db.query(
    `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, midia_path, midia_mime, midia_nome, status, admin_id)
     VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, 'enviando', ?)`,
    [empresaId, conversa.id, temp, tipo, texto || null, rel, midia?.mime || null, midia?.nome || null, adminId || null]
  );
  const id = ins.insertId;
  if (citada?.waId && await temColuna("whatsapp_mensagens", "resposta_a_wa_id")) {
    await db.query("UPDATE whatsapp_mensagens SET resposta_a_wa_id = ?, resposta_previa = ? WHERE id = ? AND empresa_id = ?",
      [String(citada.waId).slice(0, 120), String(citada.texto || "").replace(/\s+/g, " ").slice(0, 200) || null, id, empresaId]);
  }
  if (automatica && await temColuna("whatsapp_mensagens", "automatica")) {
    await db.query("UPDATE whatsapp_mensagens SET automatica = 1 WHERE id = ? AND empresa_id = ?", [id, empresaId]);
  }
  const numero = conversa.telefone ? wpp.formatarNumeroComNonoDigito(conversa.telefone) : conversa.jid;
  const headers = { apikey: evo.apiKey, "Content-Type": "application/json" };
  try {
    let r;
    if (especial) {
      r = await axios.post(`${evo.apiUrl}/message/${especial.endpoint}/${evo.instanceName}`, { number: numero, ...especial.corpo }, { headers, timeout: 20000 });
    } else if (!midia) {
      const corpoTexto = { number: numero, text: texto };
      if (citada?.waId) {
        corpoTexto.quoted = { key: { id: citada.waId, fromMe: !!citada.fromMe, remoteJid: conversa.jid }, message: { conversation: String(citada.texto || "").slice(0, 200) } };
      }
      r = await axios.post(`${evo.apiUrl}/message/sendText/${evo.instanceName}`, corpoTexto, { headers, timeout: 20000 });
    } else if (tipo === "audio") {
      r = await axios.post(`${evo.apiUrl}/message/sendWhatsAppAudio/${evo.instanceName}`,
        { number: numero, audio: midia.buffer.toString("base64"), encoding: true }, { headers, timeout: 60000 });
    } else {
      r = await axios.post(`${evo.apiUrl}/message/sendMedia/${evo.instanceName}`, {
        number: numero,
        mediatype: tipo === "imagem" ? "image" : tipo === "video" ? "video" : "document",
        mimetype: midia.mime,
        caption: texto || undefined,
        media: midia.buffer.toString("base64"),
        fileName: midia.nome || `arquivo.${midia.ext}`,
      }, { headers, timeout: 60000 });
    }
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
    // Resposta automatica nao zera as nao lidas: a equipe ainda precisa ver a mensagem do cliente.
    await db.query(
      `UPDATE whatsapp_conversas SET ultima_msg_em = NOW(), ultima_msg_previa = ?, nao_lidas = ${automatica ? "nao_lidas" : "0"} WHERE id = ? AND empresa_id = ?`,
      [(texto || PREVIA[tipo] || "Mensagem").replace(/\s+/g, " ").slice(0, 200), conversa.id, empresaId]
    );
    return { id };
  } catch (err) {
    const motivo = String(err?.response?.data?.response?.message || err?.response?.data?.message || err.message || "erro").slice(0, 250);
    await db.query("UPDATE whatsapp_mensagens SET status = 'erro', erro = ? WHERE id = ? AND empresa_id = ?", [motivo, id, empresaId]);
    throw Object.assign(new Error("Não foi possível enviar a mensagem. Confira se o WhatsApp está conectado."), { status: 502, mensagemId: id });
  }
}

const enviarTexto = (empresaId, adminId, conversa, texto, opcoes = {}) => enviarMensagem(empresaId, adminId, conversa, { tipo: "texto", texto, ...opcoes });

module.exports = {
  MAX_TEXTO, textoLocalizacao, extrairMensagem, resolverContato, normalizarEvento, processarWebhook, registrarMensagem, atualizarStatus,
  numeroDaConversa, obterOuCriarWebhookToken, empresaPorWebhookToken, ativarWebhook, statusWebhook, garantirWebhook, registrarEvento, baseWebhook, enviarTexto, enviarMensagem, baixarMidia,
};
