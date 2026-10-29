// Atendimento WhatsApp (fase 3): notas internas, etiquetas, respostas rapidas, painel do cliente e nova conversa.
// Toda query filtra por empresa_id; ids vindos do corpo sao conferidos contra a empresa antes de qualquer gravacao.
const crypto = require("crypto");
const db = require("../../db");
const svc = require("../services/whatsappAtendimento");
const { normalizarTelefone } = require("../services/whatsappNotify");
const wpp = require("./whatsappController");

const erro500 = (res, err, msg) => {
  console.error("[atendimento]", err.message);
  res.status(500).json({ error: msg });
};
const duplicado = (err) => err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062);
const ultimos10 = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function conversaDaEmpresa(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Conversa inválida" }); return null; }
  const [[c]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
  if (!c) { res.status(404).json({ error: "Conversa não encontrada" }); return null; }
  return c;
}

// ---------- Notas internas ----------

// POST /api/atendimento/conversas/:id/notas { texto }  (so a equipe ve; nao vai ao cliente nem mexe na lista)
exports.criarNota = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const t = texto(req.body?.texto, svc.MAX_TEXTO);
    if (!t) return res.status(400).json({ error: "Digite a nota" });
    const [r] = await db.query(
      `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, admin_id)
       VALUES (?, ?, ?, 'nota', 'texto', ?, 'enviada', ?)`,
      [req.empresa_id, conversa.id, `nota_${crypto.randomUUID()}`, t, req.user.id]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    erro500(res, err, "Erro ao salvar a nota");
  }
};

// ---------- Etiquetas ----------

const COR = /^#[0-9a-fA-F]{6}$/;

exports.listarEtiquetas = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, nome, cor FROM whatsapp_etiquetas WHERE empresa_id = ? ORDER BY nome", [req.empresa_id]);
    res.json({ etiquetas: rows });
  } catch (err) {
    res.json({ etiquetas: [] }); // migration 049 ainda nao rodou: a tela segue sem etiquetas
  }
};

function lerEtiqueta(body) {
  const nome = texto(body?.nome, 40);
  const cor = typeof body?.cor === "string" ? body.cor.trim() : "#2563eb";
  if (!nome) return { erro: "Informe o nome da etiqueta" };
  if (!COR.test(cor)) return { erro: "Cor inválida" };
  return { nome, cor: cor.toLowerCase() };
}

exports.criarEtiqueta = async (req, res) => {
  const e = lerEtiqueta(req.body);
  if (e.erro) return res.status(400).json({ error: e.erro });
  try {
    const [r] = await db.query("INSERT INTO whatsapp_etiquetas (empresa_id, nome, cor) VALUES (?, ?, ?)", [req.empresa_id, e.nome, e.cor]);
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    if (duplicado(err)) return res.status(409).json({ error: "Já existe uma etiqueta com esse nome" });
    erro500(res, err, "Erro ao criar etiqueta");
  }
};

exports.atualizarEtiqueta = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Etiqueta inválida" });
  const e = lerEtiqueta(req.body);
  if (e.erro) return res.status(400).json({ error: e.erro });
  try {
    const [r] = await db.query("UPDATE whatsapp_etiquetas SET nome = ?, cor = ? WHERE id = ? AND empresa_id = ?", [e.nome, e.cor, id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Etiqueta não encontrada" });
    res.json({ success: true });
  } catch (err) {
    if (duplicado(err)) return res.status(409).json({ error: "Já existe uma etiqueta com esse nome" });
    erro500(res, err, "Erro ao atualizar etiqueta");
  }
};

exports.excluirEtiqueta = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Etiqueta inválida" });
  try {
    const [r] = await db.query("DELETE FROM whatsapp_etiquetas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Etiqueta não encontrada" });
    await db.query("DELETE FROM whatsapp_conversa_etiquetas WHERE etiqueta_id = ? AND empresa_id = ?", [id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao excluir etiqueta");
  }
};

// PUT /api/atendimento/conversas/:id/etiquetas { ids: [..] }  (substitui o conjunto da conversa)
exports.definirEtiquetasDaConversa = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const brutos = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!brutos || brutos.length > 20 || !brutos.every((x) => Number.isInteger(x) && x > 0)) return res.status(400).json({ error: "Etiquetas inválidas" });
    const ids = [...new Set(brutos)];
    if (ids.length) {
      const [validas] = await db.query(`SELECT id FROM whatsapp_etiquetas WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [req.empresa_id, ...ids]);
      if (validas.length !== ids.length) return res.status(400).json({ error: "Etiqueta não encontrada" });
    }
    await db.query("DELETE FROM whatsapp_conversa_etiquetas WHERE conversa_id = ? AND empresa_id = ?", [conversa.id, req.empresa_id]);
    if (ids.length) {
      await db.query("INSERT INTO whatsapp_conversa_etiquetas (conversa_id, etiqueta_id, empresa_id) VALUES ?", [ids.map((i) => [conversa.id, i, req.empresa_id])]);
    }
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao salvar etiquetas da conversa");
  }
};

// ---------- Respostas rapidas ----------

const ATALHO = /^[a-z0-9_-]{1,30}$/;

exports.listarRespostas = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, atalho, titulo, texto FROM whatsapp_respostas_rapidas WHERE empresa_id = ? ORDER BY atalho", [req.empresa_id]);
    res.json({ respostas: rows });
  } catch (err) {
    res.json({ respostas: [] });
  }
};

function lerResposta(body) {
  const atalho = (typeof body?.atalho === "string" ? body.atalho.trim() : "").toLowerCase().replace(/^\//, ""); // sem truncar: 31+ chars deve falhar
  const titulo = texto(body?.titulo, 60);
  const t = texto(body?.texto, 1000);
  if (!ATALHO.test(atalho)) return { erro: "Atalho inválido: use letras minúsculas, números, - ou _ (até 30)" };
  if (!titulo) return { erro: "Informe o título" };
  if (!t) return { erro: "Informe o texto da resposta" };
  return { atalho, titulo, texto: t };
}

exports.criarResposta = async (req, res) => {
  const r = lerResposta(req.body);
  if (r.erro) return res.status(400).json({ error: r.erro });
  try {
    const [ins] = await db.query("INSERT INTO whatsapp_respostas_rapidas (empresa_id, atalho, titulo, texto) VALUES (?, ?, ?, ?)", [req.empresa_id, r.atalho, r.titulo, r.texto]);
    res.json({ success: true, id: ins.insertId });
  } catch (err) {
    if (duplicado(err)) return res.status(409).json({ error: "Já existe uma resposta com esse atalho" });
    erro500(res, err, "Erro ao criar resposta");
  }
};

exports.atualizarResposta = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Resposta inválida" });
  const r = lerResposta(req.body);
  if (r.erro) return res.status(400).json({ error: r.erro });
  try {
    const [up] = await db.query("UPDATE whatsapp_respostas_rapidas SET atalho = ?, titulo = ?, texto = ? WHERE id = ? AND empresa_id = ?", [r.atalho, r.titulo, r.texto, id, req.empresa_id]);
    if (!up.affectedRows) return res.status(404).json({ error: "Resposta não encontrada" });
    res.json({ success: true });
  } catch (err) {
    if (duplicado(err)) return res.status(409).json({ error: "Já existe uma resposta com esse atalho" });
    erro500(res, err, "Erro ao atualizar resposta");
  }
};

exports.excluirResposta = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Resposta inválida" });
  try {
    const [r] = await db.query("DELETE FROM whatsapp_respostas_rapidas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Resposta não encontrada" });
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao excluir resposta");
  }
};

// ---------- Painel do cliente ----------

const mascararCpf = (cpf) => {
  const d = String(cpf || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : null;
};

/** Lead da conversa: o vinculado (da empresa) ou, se nao houver, o de mesmo telefone. */
async function leadDaConversa(empresaId, conversa) {
  if (conversa.lead_id) {
    const [[l]] = await db.query("SELECT * FROM leads WHERE id = ? AND empresa_id = ?", [conversa.lead_id, empresaId]);
    if (l) return l;
  }
  if (conversa.telefone && ultimos10(conversa.telefone).length === 10) {
    const [rows] = await db.query(
      `SELECT * FROM leads WHERE empresa_id = ? AND telefone IS NOT NULL AND telefone <> ''
         AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10) = ? ORDER BY id LIMIT 1`,
      [empresaId, ultimos10(conversa.telefone)]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

// GET /api/atendimento/conversas/:id/cliente
exports.clienteDaConversa = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [req.empresa_id]);
    const lead = await leadDaConversa(req.empresa_id, conversa);
    const resp = { empresa: emp?.nome || null, lead: null, plano: null, ultimo_pagamento: null };
    if (lead) {
      resp.lead = {
        id: lead.id, nome: lead.nome, cpf: mascararCpf(lead.cpf), email: lead.email || null, telefone: lead.telefone || null,
        status: lead.status, origem: lead.origem, sem_promocoes: !!lead.whatsapp_optout, lgpd_aceite: !!lead.lgpd_aceite,
      };
      const cpfLimpo = String(lead.cpf || "").replace(/\D/g, "");
      try {
        if (cpfLimpo) {
          const [[ru]] = await db.query(
            `SELECT p.nome, p.duracao_minutos FROM radius_users ru LEFT JOIN planos p ON p.id = ru.plano_id
              WHERE ru.empresa_id = ? AND ru.username = ? LIMIT 1`,
            [req.empresa_id, cpfLimpo]
          );
          if (ru?.nome) resp.plano = { nome: ru.nome, duracao_minutos: ru.duracao_minutos };
          const [[pg]] = await db.query(
            `SELECT pg.valor, pg.status, pg.metodo_pagamento, pg.criado_em, p.nome AS plano
               FROM pagamentos pg LEFT JOIN planos p ON p.id = pg.plano_id
              WHERE pg.empresa_id = ? AND REPLACE(REPLACE(REPLACE(pg.cpf,'.',''),'-',''),' ','') = ?
              ORDER BY pg.id DESC LIMIT 1`,
            [req.empresa_id, cpfLimpo]
          );
          if (pg) resp.ultimo_pagamento = pg;
        }
      } catch (err) {
        console.warn("[atendimento] resumo de plano indisponivel:", err.message);
      }
    }
    res.json(resp);
  } catch (err) {
    erro500(res, err, "Erro ao carregar o cliente");
  }
};

// POST /api/atendimento/conversas/:id/vincular { lead_id }  (null desvincula)
exports.vincularCliente = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    const leadId = req.body?.lead_id;
    if (leadId === null) {
      await db.query("UPDATE whatsapp_conversas SET lead_id = NULL WHERE id = ? AND empresa_id = ?", [conversa.id, req.empresa_id]);
      return res.json({ success: true });
    }
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: "Cliente inválido" });
    const [[l]] = await db.query("SELECT id, nome FROM leads WHERE id = ? AND empresa_id = ?", [leadId, req.empresa_id]);
    if (!l) return res.status(404).json({ error: "Cliente não encontrado" });
    await db.query("UPDATE whatsapp_conversas SET lead_id = ?, nome = COALESCE(NULLIF(nome, ''), ?) WHERE id = ? AND empresa_id = ?", [l.id, l.nome, conversa.id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) {
    erro500(res, err, "Erro ao vincular o cliente");
  }
};

// GET /api/atendimento/clientes?q=  (busca para vincular: nome, telefone ou e-mail; nunca devolve CPF)
exports.buscarClientes = async (req, res) => {
  try {
    const q = texto(req.query.q, 60);
    if (q.length < 2) return res.json({ clientes: [] });
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const [rows] = await db.query(
      `SELECT id, nome, telefone, email FROM leads
        WHERE empresa_id = ? AND (nome LIKE ? OR telefone LIKE ? OR email LIKE ?) ORDER BY nome LIMIT 10`,
      [req.empresa_id, like, like, like]
    );
    res.json({ clientes: rows });
  } catch (err) {
    erro500(res, err, "Erro ao buscar clientes");
  }
};

// POST /api/atendimento/conversas/:id/criar-cliente  (cadastra o contato como cliente, sem CPF nem consentimento LGPD)
exports.criarClienteDaConversa = async (req, res) => {
  try {
    const conversa = await conversaDaEmpresa(req, res);
    if (!conversa) return;
    if (!conversa.telefone) return res.status(400).json({ error: "Esta conversa não tem número de telefone identificado" });
    const existente = await leadDaConversa(req.empresa_id, conversa);
    if (existente) {
      await db.query("UPDATE whatsapp_conversas SET lead_id = ? WHERE id = ? AND empresa_id = ?", [existente.id, conversa.id, req.empresa_id]);
      return res.json({ success: true, id: existente.id, ja_existia: true });
    }
    const nome = texto(req.body?.nome, 150) || conversa.nome || `WhatsApp ${String(conversa.telefone).slice(-4)}`;
    const [r] = await db.query(
      `INSERT INTO leads (empresa_id, nome, telefone, sistema_origem, origem, status, lgpd_aceite)
       VALUES (?, ?, ?, 'whatsapp', 'whatsapp', 'novo', 0)`,
      [req.empresa_id, nome, conversa.telefone]
    );
    await db.query("UPDATE whatsapp_conversas SET lead_id = ? WHERE id = ? AND empresa_id = ?", [r.insertId, conversa.id, req.empresa_id]);
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    erro500(res, err, "Erro ao cadastrar o cliente");
  }
};

// ---------- Nova conversa ----------

// POST /api/atendimento/conversas { telefone, nome?, texto? }
exports.novaConversa = async (req, res) => {
  try {
    const telefone = normalizarTelefone(req.body?.telefone);
    if (!telefone) return res.status(400).json({ error: "Telefone inválido. Informe DDD + número." });
    const t = texto(req.body?.texto, svc.MAX_TEXTO);
    const fim = ultimos10(telefone);

    // quem pediu para sair das mensagens nao recebe contato iniciado pela empresa
    const [opt] = await db.query(
      `SELECT id FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1 AND telefone IS NOT NULL
         AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10) = ? LIMIT 1`,
      [req.empresa_id, fim]
    ).catch(() => [[]]);
    if (opt.length) return res.status(409).json({ error: "Este contato pediu para não receber mensagens (SAIR)." });

    let [[conversa]] = await db.query(
      `SELECT * FROM whatsapp_conversas WHERE empresa_id = ? AND telefone IS NOT NULL
         AND RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10) = ? ORDER BY id LIMIT 1`,
      [req.empresa_id, fim]
    );
    let criada = false;
    if (!conversa) {
      const jid = `${wpp.formatarNumeroComNonoDigito(telefone)}@s.whatsapp.net`;
      const lead = await leadDaConversa(req.empresa_id, { telefone });
      const nome = texto(req.body?.nome, 150) || lead?.nome || null;
      const [ins] = await db.query(
        `INSERT INTO whatsapp_conversas (empresa_id, jid, telefone, nome, lead_id, ultima_msg_em)
         VALUES (?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [req.empresa_id, jid, telefone, nome, lead?.id || null]
      );
      [[conversa]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [ins.insertId, req.empresa_id]);
      criada = true;
    }
    if (t) await svc.enviarTexto(req.empresa_id, req.user.id, conversa, t);
    res.json({ success: true, id: conversa.id, criada });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, mensagem_id: err.mensagemId });
    erro500(res, err, "Erro ao iniciar a conversa");
  }
};
