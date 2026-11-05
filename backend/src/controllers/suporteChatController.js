// Chat do balao de suporte: a empresa-cliente fala com a equipe da plataforma DENTRO do sistema. A conversa vive na caixa
// de entrada (hub WhatsApp) da empresa da plataforma (SITE_EMPRESA_ID), com um jid proprio (nunca vai ao WhatsApp).
const db = require("../../db");
const { jidChatPainel, textoChat } = require("../utils/suporte");

const plataformaId = () => parseInt(process.env.SITE_EMPRESA_ID, 10) || 1;
const SEM_TABELA = "O chat de suporte ainda não está disponível neste servidor.";

async function conversaDaEmpresa(empresaId) {
  const [[c]] = await db.query("SELECT id FROM whatsapp_conversas WHERE empresa_id = ? AND jid = ?", [plataformaId(), jidChatPainel(empresaId)]);
  return c ? c.id : null;
}

// GET /api/suporte/chat?depois_de=<id>  -> mensagens da PROPRIA empresa (a equipe da plataforma nao usa o balao)
exports.listar = async (req, res) => {
  try {
    if (Number(req.empresa_id) === plataformaId()) return res.json({ disponivel: false, mensagens: [] });
    const convId = await conversaDaEmpresa(req.empresa_id);
    if (!convId) return res.json({ disponivel: true, mensagens: [] });
    const depois = parseInt(req.query.depois_de, 10);
    const [rows] = await db.query(
      `SELECT m.id, m.direcao, m.texto, m.criado_em, a.nome AS autor FROM whatsapp_mensagens m LEFT JOIN admins a ON a.id = m.admin_id
        WHERE m.empresa_id = ? AND m.conversa_id = ? AND m.direcao IN ('in','out') ${Number.isInteger(depois) ? "AND m.id > ?" : ""}
        ORDER BY m.id DESC LIMIT 100`,
      Number.isInteger(depois) ? [plataformaId(), convId, depois] : [plataformaId(), convId]
    );
    // Quem atende ve so "Suporte"; o nome de quem escreveu pelo painel da empresa e' dele mesmo
    res.json({ disponivel: true, mensagens: rows.reverse().map((r) => ({ id: r.id, de: r.direcao === "in" ? "cliente" : "suporte", texto: r.texto, criado_em: r.criado_em })) });
  } catch (err) {
    console.error("[suporte-chat] listar:", err.message);
    res.status(500).json({ error: SEM_TABELA });
  }
};

// POST /api/suporte/chat { texto }
exports.enviar = async (req, res) => {
  try {
    if (Number(req.empresa_id) === plataformaId()) return res.status(400).json({ error: "Esta é a conta da plataforma." });
    const texto = textoChat(req.body && req.body.texto);
    if (!texto) return res.status(400).json({ error: "Escreva uma mensagem de até 1000 caracteres." });
    const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [req.empresa_id]);
    const nome = `Suporte: ${String(emp?.nome || `Empresa ${req.empresa_id}`).slice(0, 80)}`;
    const jid = jidChatPainel(req.empresa_id);
    const [r] = await db.query(
      `INSERT INTO whatsapp_conversas (empresa_id, jid, nome, ultima_msg_em) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [plataformaId(), jid, nome]
    );
    const convId = r.insertId;
    const [ins] = await db.query(
      `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, admin_id) VALUES (?, ?, ?, 'in', 'texto', ?, 'entregue', ?)`,
      [plataformaId(), convId, `painel_${require("crypto").randomUUID()}`, texto, null]
    );
    // Reabre a conversa e conta como nao lida para a equipe
    await db.query(
      `UPDATE whatsapp_conversas SET ultima_msg_em = NOW(), ultima_msg_previa = ?, nao_lidas = nao_lidas + 1, status = 'aberta', nome = ? WHERE id = ? AND empresa_id = ?`,
      [texto.replace(/\s+/g, " ").slice(0, 200), nome, convId, plataformaId()]
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) {
    console.error("[suporte-chat] enviar:", err.message);
    res.status(500).json({ error: "Não foi possível enviar agora." });
  }
};
