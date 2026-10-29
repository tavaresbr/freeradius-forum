// Atendimento por WhatsApp: caixa de entrada compartilhada da empresa (todas as queries por empresa_id).
const db = require("../../db");
const fs = require("fs");
const svc = require("../services/whatsappAtendimento");
const midiaUtil = require("../utils/whatsappMidia");
const { temColuna } = require("../utils/schemaCache");

const erro500 = (res, err, msg) => {
  console.error("[atendimento]", err.message);
  // tabela ausente = migration nao rodou: diz o que fazer em vez de um erro generico
  if (err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146)) {
    return res.status(503).json({ error: "O atendimento WhatsApp ainda não foi preparado neste servidor. Rode as migrations 048 e 049 (node migrations/048_whatsapp_atendimento.js) e reinicie o backend." });
  }
  res.status(500).json({ error: msg });
};

const inteiro = (v, padrao, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

async function conversaDaEmpresa(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Conversa inválida" }); return null; }
  const [[c]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
  if (!c) { res.status(404).json({ error: "Conversa não encontrada" }); return null; }
  return c;
}

/** Coloca `etiquetas: [{id, nome, cor}]` em cada conversa (uma consulta so). Sem a migration 049 segue sem etiquetas. */
async function anexarEtiquetas(empresaId, conversas) {
  conversas.forEach((c) => { c.etiquetas = []; });
  if (!conversas.length) return;
  try {
    const ids = conversas.map((c) => c.id);
    const [rows] = await db.query(
      `SELECT ce.conversa_id, e.id, e.nome, e.cor FROM whatsapp_conversa_etiquetas ce
         JOIN whatsapp_etiquetas e ON e.id = ce.etiqueta_id AND e.empresa_id = ce.empresa_id
        WHERE ce.empresa_id = ? AND ce.conversa_id IN (${ids.map(() => "?").join(",")}) ORDER BY e.nome`,
      [empresaId, ...ids]
    );
    const porConversa = new Map(conversas.map((c) => [c.id, c.etiquetas]));
    for (const r of rows) porConversa.get(r.conversa_id)?.push({ id: r.id, nome: r.nome, cor: r.cor });
  } catch (err) { /* tabela nova ausente */ }
}

/** Coloca `atendente_nome` em cada conversa que tem dono. */
async function anexarAtendentes(empresaId, conversas) {
  const ids = [...new Set(conversas.map((c) => c.atendente_id).filter(Boolean))];
  if (!ids.length) return;
  try {
    const [rows] = await db.query(
      `SELECT id, nome FROM admins WHERE id IN (${ids.map(() => "?").join(",")})`, // atendente_id so e' gravado por quem assume ou por vinculo da empresa
      ids
    );
    const nomes = new Map(rows.map((r) => [r.id, r.nome]));
    conversas.forEach((c) => { if (c.atendente_id) c.atendente_nome = nomes.get(c.atendente_id) || null; });
  } catch (err) { /* sem nome: a tela mostra so "atribuida" */ }
}

// GET /api/atendimento/conversas?status=aberta|resolvida|todas&nao_lidas=1&q=&pagina=1
exports.listarConversas = async (req, res) => {
  try {
    const status = ["aberta", "resolvida"].includes(req.query.status) ? req.query.status : null;
    const limite = 50;
    const pagina = inteiro(req.query.pagina, 1, 1, 1000);
    const where = ["empresa_id = ?"];
    const params = [req.empresa_id];
    if (status) { where.push("status = ?"); params.push(status); }
    if (req.query.nao_lidas === "1") where.push("nao_lidas > 0");
    const etiqueta = parseInt(req.query.etiqueta, 10);
    if (Number.isInteger(etiqueta)) {
      where.push("id IN (SELECT conversa_id FROM whatsapp_conversa_etiquetas WHERE empresa_id = ? AND etiqueta_id = ?)");
      params.push(req.empresa_id, etiqueta);
    }
    const temAtendente = await temColuna("whatsapp_conversas", "atendente_id");
    if (temAtendente) {
      const at = String(req.query.atendente || "");
      if (at === "eu") { where.push("atendente_id = ?"); params.push(req.user.id); }
      else if (at === "sem") where.push("atendente_id IS NULL");
      else if (/^\d+$/.test(at)) { where.push("atendente_id = ?"); params.push(parseInt(at, 10)); }
    }
    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      if (q.length >= 3) {
        // alem do nome/telefone/previa, procura dentro do texto das mensagens da conversa
        where.push("(nome LIKE ? OR telefone LIKE ? OR ultima_msg_previa LIKE ? OR EXISTS (SELECT 1 FROM whatsapp_mensagens mm WHERE mm.conversa_id = whatsapp_conversas.id AND mm.empresa_id = ? AND mm.texto LIKE ?))");
        params.push(like, like, like, req.empresa_id, like);
      } else {
        where.push("(nome LIKE ? OR telefone LIKE ? OR ultima_msg_previa LIKE ?)");
        params.push(like, like, like);
      }
    }
    const [rows] = await db.query(
      `SELECT id, jid, telefone, nome, lead_id, status, nao_lidas, ultima_msg_em, ultima_msg_previa${temAtendente ? ", atendente_id, atribuido_em" : ""}
         FROM whatsapp_conversas WHERE ${where.join(" AND ")}
        ORDER BY ultima_msg_em DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limite + 1, (pagina - 1) * limite]
    );
    const conversas = rows.slice(0, limite);
    await anexarEtiquetas(req.empresa_id, conversas);
    await anexarAtendentes(req.empresa_id, conversas);
    res.json({ conversas, tem_mais: rows.length > limite });
  } catch (err) {
    erro500(res, err, "Erro ao listar conversas");
  }
};

// GET /api/atendimento/conversas/:id/mensagens?limite=60&antes_de=<id>
exports.listarMensagens = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const limite = inteiro(req.query.limite, 60, 1, 200);
    const antes = parseInt(req.query.antes_de, 10);
    const temCitacao = await temColuna("whatsapp_mensagens", "resposta_a_wa_id");
    const temAuto = await temColuna("whatsapp_mensagens", "automatica");
    const temExp = await temColuna("whatsapp_mensagens", "midia_expirada_em");
    const [rows] = await db.query(
      `SELECT m.id, m.direcao, m.tipo, m.texto, m.midia_nome, m.midia_mime, (m.midia_mime IS NOT NULL) AS tem_midia, m.status, m.erro, m.admin_id, m.criado_em, a.nome AS autor${temCitacao ? ", m.resposta_a_wa_id, m.resposta_previa" : ""}${temAuto ? ", m.automatica" : ""}${temExp ? ", (m.midia_expirada_em IS NOT NULL) AS midia_expirada" : ""}
         FROM whatsapp_mensagens m LEFT JOIN admins a ON a.id = m.admin_id
        WHERE m.empresa_id = ? AND m.conversa_id = ? ${Number.isInteger(antes) ? "AND m.id < ?" : ""}
        ORDER BY m.id DESC LIMIT ?`,
      Number.isInteger(antes) ? [req.empresa_id, conversa.id, antes, limite + 1] : [req.empresa_id, conversa.id, limite + 1]
    );
    const [soConversa] = [[conversa]];
    await anexarEtiquetas(req.empresa_id, soConversa);
    await anexarAtendentes(req.empresa_id, soConversa);
    res.json({ conversa, mensagens: rows.slice(0, limite).reverse(), tem_mais: rows.length > limite });
  } catch (err) {
    erro500(res, err, "Erro ao listar mensagens");
  }
};

// POST /api/atendimento/conversas/:id/mensagens { texto }
exports.enviarMensagem = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
    if (!texto) return res.status(400).json({ error: "Digite a mensagem" });
    if (texto.length > svc.MAX_TEXTO) return res.status(400).json({ error: `Mensagem muito longa (máximo ${svc.MAX_TEXTO} caracteres)` });
    // citacao: so mensagens (recebidas ou enviadas) desta conversa e desta empresa
    let citada = null;
    const rid = parseInt(req.body?.responder_a, 10);
    if (Number.isInteger(rid)) {
      const [[m]] = await db.query(
        "SELECT wa_id, direcao, texto, tipo FROM whatsapp_mensagens WHERE id = ? AND empresa_id = ? AND conversa_id = ? AND direcao IN ('in','out') AND wa_id NOT LIKE 'tmp\\_%'",
        [rid, req.empresa_id, conversa.id]
      );
      if (m) citada = { waId: m.wa_id, fromMe: m.direcao === "out", texto: m.texto || ({ imagem: "📷 Imagem", audio: "🎤 Áudio", video: "🎥 Vídeo", documento: "📄 Documento" }[m.tipo] || "Mensagem") };
    }
    const r = await svc.enviarTexto(req.empresa_id, req.user.id, conversa, texto, { citada });
    res.json({ success: true, id: r.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, mensagem_id: err.mensagemId });
    erro500(res, err, "Erro ao enviar mensagem");
  }
};

// POST /api/atendimento/conversas/:id/midia  (multipart: arquivo, legenda)
exports.enviarMidia = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    if (!req.file) return res.status(400).json({ error: "Escolha um arquivo para enviar" });
    const legenda = typeof req.body?.legenda === "string" ? req.body.legenda.trim().slice(0, 1000) : "";
    let arq;
    try {
      arq = midiaUtil.validarArquivo(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const r = await svc.enviarMensagem(req.empresa_id, req.user.id, conversa, {
      tipo: arq.tipo, texto: legenda, midia: { buffer: req.file.buffer, mime: arq.mime, ext: arq.ext, nome: arq.nome },
    });
    res.json({ success: true, id: r.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, mensagem_id: err.mensagemId });
    erro500(res, err, "Erro ao enviar arquivo");
  }
};

// GET /api/atendimento/midia/:id  (autenticada; escopada por empresa)
exports.servirMidia = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Mídia inválida" });
    const temExp = await temColuna("whatsapp_mensagens", "midia_expirada_em");
    const [[msg]] = await db.query(
      `SELECT id, wa_id, direcao, midia_path, midia_mime, midia_nome${temExp ? ", midia_expirada_em" : ""} FROM whatsapp_mensagens WHERE id = ? AND empresa_id = ? AND midia_mime IS NOT NULL`,
      [id, req.empresa_id]
    );
    if (!msg) return res.status(404).json({ error: "Mídia não encontrada" });
    // Removida pelo expurgo automatico: nao tenta baixar de novo
    if (msg.midia_expirada_em) return res.status(410).json({ error: "Mídia removida pela limpeza automática" });
    let rel = msg.midia_path;
    if (!rel && msg.direcao === "in") {
      try { rel = await svc.baixarMidia(req.empresa_id, msg); }
      catch (err) { return res.status(502).json({ error: "Não foi possível baixar a mídia agora. Tente de novo em instantes." }); }
    }
    const abs = midiaUtil.caminhoAbsoluto(rel);
    if (!abs) return res.status(404).json({ error: "Mídia não encontrada" });
    let buf;
    try { buf = await fs.promises.readFile(abs); }
    catch { return res.status(404).json({ error: "Arquivo não encontrado no servidor" }); }
    const mime = midiaUtil.mimeAceito(msg.midia_mime);
    if (!mime) return res.status(404).json({ error: "Mídia não encontrada" });
    const nome = encodeURIComponent(msg.midia_nome || `arquivo.${midiaUtil.TIPOS[mime].ext}`);
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", `${midiaUtil.INLINE(mime) ? "inline" : "attachment"}; filename*=UTF-8''${nome}`);
    res.send(buf);
  } catch (err) {
    erro500(res, err, "Erro ao carregar a mídia");
  }
};

// PUT /api/atendimento/conversas/:id { status?, nome? }
exports.atualizarConversa = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const sets = [];
    const params = [];
    if (req.body?.status !== undefined) {
      if (!["aberta", "resolvida"].includes(req.body.status)) return res.status(400).json({ error: "Status inválido" });
      sets.push("status = ?"); params.push(req.body.status);
    }
    if (req.body?.nome !== undefined) {
      if (typeof req.body.nome !== "string") return res.status(400).json({ error: "Nome inválido" });
      sets.push("nome = ?"); params.push(req.body.nome.trim().slice(0, 150) || null);
    }
    if (!sets.length) return res.status(400).json({ error: "Nada para alterar" });
    await db.query(`UPDATE whatsapp_conversas SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ?`, [...params, conversa.id, req.empresa_id]);
    // Resolvida: pede a nota de satisfacao (se a empresa ligou). Falha nunca atrapalha o status.
    if (req.body?.status === "resolvida" && conversa.status !== "resolvida") {
      await require("../services/whatsappSatisfacao").pedirNota(req.empresa_id, req.user?.id, conversa);
    }
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao atualizar conversa");
  }
};

// POST /api/atendimento/conversas/:id/lida
exports.marcarLida = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    await db.query("UPDATE whatsapp_conversas SET nao_lidas = 0 WHERE id = ? AND empresa_id = ?", [conversa.id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao marcar como lida");
  }
};

// GET /api/atendimento/nao-lidas  (contador do menu)
exports.naoLidas = async (req, res) => {
  try {
    const [[r]] = await db.query(
      "SELECT COALESCE(SUM(nao_lidas), 0) AS mensagens, COALESCE(SUM(nao_lidas > 0), 0) AS conversas FROM whatsapp_conversas WHERE empresa_id = ? AND status = 'aberta'",
      [req.empresa_id]
    );
    res.json({ mensagens: Number(r.mensagens), conversas: Number(r.conversas) });
  } catch (err) {
    // tabela ainda nao migrada: o menu so nao mostra contador
    res.json({ mensagens: 0, conversas: 0 });
  }
};

// POST /api/whatsapp-webhook/:token  (publico; o token da URL identifica a empresa)
exports.receberWebhook = async (req, res) => {
  try {
    const dono = await svc.empresaPorWebhookToken(req.params.token);
    if (!dono) return res.status(404).json({ error: "Webhook desconhecido" });
    // So aceita eventos da instancia da propria empresa (o corpo nunca define a empresa).
    const instancia = req.body?.instance;
    if (instancia && typeof instancia === "string" && instancia !== dono.instancia) return res.status(200).json({ ok: true, ignorado: true });
    res.status(200).json({ ok: true });
    svc.registrarEvento(dono.empresaId, req.body?.event);
    console.log(`[atendimento] webhook empresa=${dono.empresaId} evento=${String(req.body?.event || "").slice(0, 40)}`);
    await svc.processarWebhook(dono.empresaId, req.body);
  } catch (err) {
    console.error("[atendimento] webhook:", err.message);
    if (!res.headersSent) res.status(200).json({ ok: false });
  }
};

// POST /api/atendimento/webhook/garantir  (registra o recebimento se faltar ou estiver com URL antiga)
exports.garantirWebhook = async (req, res) => {
  try {
    res.json(await svc.garantirWebhook(req.empresa_id));
  } catch (err) {
    res.json({ ativo: false });
  }
};
