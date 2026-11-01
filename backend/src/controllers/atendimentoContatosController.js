// Aba "Contatos" do hub WhatsApp: conversas + clientes com telefone numa lista so (dedupe pelos 10 ultimos digitos).
// Toda query por empresa_id; o CPF nunca sai daqui.
const db = require("../../db");
const { exprTelefoneFim10, EXPR_ANTIGA } = require("../utils/telefoneBusca");

const LIMITE = 50;
const inteiro = (v, padrao, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

/** Expressao "ultimos 10 digitos" do lead com alias `l` (a coluna gerada, ou a expressao antiga). */
const exprDoLead = (expr) => (expr === "telefone_fim10" ? "l.telefone_fim10" : EXPR_ANTIGA.replace("telefone", "l.telefone"));

async function anexarEtiquetas(empresaId, itens) {
  itens.forEach((i) => { i.etiquetas = []; });
  const comConversa = itens.filter((i) => i.conversa_id);
  if (!comConversa.length) return;
  try {
    const ids = comConversa.map((i) => i.conversa_id);
    const [rows] = await db.query(
      `SELECT ce.conversa_id, e.id, e.nome, e.cor FROM whatsapp_conversa_etiquetas ce
         JOIN whatsapp_etiquetas e ON e.id = ce.etiqueta_id AND e.empresa_id = ce.empresa_id
        WHERE ce.empresa_id = ? AND ce.conversa_id IN (${ids.map(() => "?").join(",")}) ORDER BY e.nome`,
      [empresaId, ...ids]
    );
    const porConversa = new Map(comConversa.map((i) => [i.conversa_id, i.etiquetas]));
    for (const r of rows) porConversa.get(r.conversa_id)?.push({ id: r.id, nome: r.nome, cor: r.cor });
  } catch { /* tabela de etiquetas ausente: segue sem */ }
}

// GET /api/atendimento/contatos?q=&origem=conversas|sem_conversa&optout=1&etiqueta=<id>&pagina=1
exports.listarContatos = async (req, res) => {
  try {
    const pagina = inteiro(req.query.pagina, 1, 1, 1000);
    const expr = exprDoLead(await exprTelefoneFim10());
    const filtros = [];
    const fParams = [];
    const origem = String(req.query.origem || "");
    if (origem === "conversas") filtros.push("t.origem = 'conversa'");
    else if (origem === "sem_conversa") filtros.push("t.origem = 'lead'");
    if (req.query.optout === "1") filtros.push("t.optout = 1");
    const etiqueta = parseInt(req.query.etiqueta, 10);
    if (Number.isInteger(etiqueta)) {
      filtros.push("t.conversa_id IN (SELECT conversa_id FROM whatsapp_conversa_etiquetas WHERE empresa_id = ? AND etiqueta_id = ?)");
      fParams.push(req.empresa_id, etiqueta);
    }
    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      filtros.push("(t.nome LIKE ? OR t.telefone LIKE ?)");
      fParams.push(like, like);
    }
    const [rows] = await db.query(
      `SELECT t.* FROM (
         SELECT 'conversa' COLLATE utf8mb4_unicode_ci AS origem, c.id AS conversa_id, c.lead_id, c.nome COLLATE utf8mb4_unicode_ci AS nome, c.telefone COLLATE utf8mb4_unicode_ci AS telefone,
                c.ultima_msg_em AS atividade, c.nao_lidas, c.status COLLATE utf8mb4_unicode_ci AS status_conversa,
                COALESCE(l.whatsapp_optout, 0) AS optout
           FROM whatsapp_conversas c
           LEFT JOIN leads l ON l.id = c.lead_id AND l.empresa_id = c.empresa_id
          WHERE c.empresa_id = ?
         UNION ALL
         SELECT 'lead' COLLATE utf8mb4_unicode_ci AS origem, NULL AS conversa_id, l.id AS lead_id, l.nome COLLATE utf8mb4_unicode_ci AS nome, l.telefone COLLATE utf8mb4_unicode_ci AS telefone,
                l.criado_em AS atividade, 0 AS nao_lidas, NULL AS status_conversa,
                COALESCE(l.whatsapp_optout, 0) AS optout
           FROM leads l
          WHERE l.empresa_id = ? AND l.telefone IS NOT NULL AND l.telefone <> ''
            AND NOT EXISTS (SELECT 1 FROM whatsapp_conversas c2 WHERE c2.empresa_id = l.empresa_id
                              AND c2.telefone IS NOT NULL AND RIGHT(c2.telefone, 10) COLLATE utf8mb4_unicode_ci = ${expr} COLLATE utf8mb4_unicode_ci)
       ) t
       ${filtros.length ? `WHERE ${filtros.join(" AND ")}` : ""}
       ORDER BY t.atividade DESC, t.lead_id DESC, t.conversa_id DESC LIMIT ? OFFSET ?`,
      [req.empresa_id, req.empresa_id, ...fParams, LIMITE + 1, (pagina - 1) * LIMITE]
    );
    const contatos = rows.slice(0, LIMITE).map((r) => ({
      origem: r.origem,
      conversa_id: r.conversa_id || null,
      lead_id: r.lead_id || null,
      nome: r.nome || null,
      telefone: r.telefone || null,
      atividade: r.atividade,
      nao_lidas: Number(r.nao_lidas) || 0,
      status_conversa: r.status_conversa || null,
      optout: Number(r.optout) === 1,
    }));
    await anexarEtiquetas(req.empresa_id, contatos);
    res.json({ contatos, tem_mais: rows.length > LIMITE, pagina });
  } catch (err) {
    console.error("[atendimento] contatos:", err.message);
    res.status(500).json({ error: "Erro ao listar os contatos" });
  }
};
