// Tela de auditoria: quem fez o que no painel (so Administrador, via checkPermissao('configuracoes')).
const db = require("../../db");

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;

// GET /api/auditoria?de=&ate=&acao=&q=&pagina=
exports.listar = async (req, res) => {
  try {
    const where = ["l.empresa_id = ?"];
    const params = [req.empresa_id];
    if (DIA.test(String(req.query.de || ""))) { where.push("l.criado_em >= ?"); params.push(`${req.query.de} 00:00:00`); }
    if (DIA.test(String(req.query.ate || ""))) { where.push("l.criado_em <= ?"); params.push(`${req.query.ate} 23:59:59`); }
    const acao = String(req.query.acao || "").trim().slice(0, 60);
    if (acao) { where.push("l.acao = ?"); params.push(acao); }
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(a.nome LIKE ? OR a.email LIKE ? OR l.detalhes LIKE ? OR l.entidade_id LIKE ?)");
      params.push(like, like, like, like);
    }
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const [[tot]] = await db.query(`SELECT COUNT(*) AS n FROM audit_logs l LEFT JOIN admins a ON a.id = l.admin_id WHERE ${where.join(" AND ")}`, params);
    const [rows] = await db.query(
      `SELECT l.id, l.acao, l.entidade, l.entidade_id, l.detalhes, l.ip, l.criado_em, a.nome AS usuario, a.email
         FROM audit_logs l LEFT JOIN admins a ON a.id = l.admin_id
        WHERE ${where.join(" AND ")} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [...params, POR_PAGINA, (pagina - 1) * POR_PAGINA]
    );
    const [acoes] = await db.query("SELECT DISTINCT acao FROM audit_logs WHERE empresa_id = ? ORDER BY acao LIMIT 100", [req.empresa_id]);
    res.json({ itens: rows, total: Number(tot.n), pagina, por_pagina: POR_PAGINA, acoes: acoes.map((x) => x.acao) });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: "Rode a migration 055 (node migrations/055_audit_logs.js) para ativar a auditoria." });
    console.error("[auditoria]", err.message);
    res.status(500).json({ error: "Erro ao carregar a auditoria" });
  }
};
