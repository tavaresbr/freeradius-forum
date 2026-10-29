const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");

exports.getDashboard = async (req, res) => {
  try {
    const empresaId = req.empresa_id;

    // Pagamentos
    const [[{ total_pagamentos }]] = await db.query(
      "SELECT COUNT(*) as total_pagamentos FROM pagamentos WHERE empresa_id = ?",
      [empresaId]
    );
    const [[{ pagamentos_24h }]] = await db.query(
      "SELECT COUNT(*) as pagamentos_24h FROM pagamentos WHERE empresa_id = ? AND criado_em >= NOW() - INTERVAL 1 DAY",
      [empresaId]
    );

    // Usuários Radius (via radius_users para filtrar por empresa)
    const [[{ total_usuarios }]] = await db.query(
      "SELECT COUNT(*) as total_usuarios FROM radius_users WHERE empresa_id = ?",
      [empresaId]
    );

    // Mikrotiks
    const [[{ total_mikrotiks }]] = await db.query(
      "SELECT COUNT(*) as total_mikrotiks FROM mikrotiks WHERE empresa_id = ?",
      [empresaId]
    );

    // Sessões por Mikrotik via radius_users
    const [sessoes] = await db.query(`
      SELECT m.nome, COUNT(r.username) AS conectados
      FROM mikrotiks m
      LEFT JOIN radius_users r ON r.nas_id = m.id
      WHERE m.empresa_id = ?
      GROUP BY m.id
    `, [empresaId]);

    res.json({
      pagamentos: {
        total: total_pagamentos,
        ultimas_24h: pagamentos_24h,
      },
      radius: {
        total_usuarios,
      },
      mikrotiks: {
        total: total_mikrotiks,
        online: total_mikrotiks
      },
      sessoes,
    });
  } catch (err) {
    console.error("Erro no dashboard:", err);
    res.status(500).json({ message: "Erro ao buscar dados do dashboard" });
  }
};

// GET /api/dashboard/hoje: numeros do dia (vendas, conexoes e, com o recurso WhatsApp, conversas). Cada bloco falha sozinho.
exports.getHoje = async (req, res) => {
  const emp = req.empresa_id;
  const out = { vendas: null, conexoes: null, whatsapp: null };
  try {
    const [[v]] = await db.query(
      "SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM pagamentos WHERE empresa_id = ? AND status = 'approved' AND criado_em >= CURDATE()",
      [emp]
    );
    out.vendas = { aprovadas: Number(v.n), valor: Number(v.total) };
  } catch (err) { console.warn("[dashboard] vendas do dia:", err.message); }
  try {
    const [[c]] = await db.query(
      `SELECT COUNT(DISTINCT IF(ra.acctstoptime IS NULL, ra.username, NULL)) AS abertas,
              COUNT(DISTINCT IF(ra.acctstarttime >= CURDATE(), ra.username, NULL)) AS novas
         FROM radacct ra JOIN radius_users ru ON ru.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci AND ru.empresa_id = ?
        WHERE ra.acctstoptime IS NULL OR ra.acctstarttime >= CURDATE()`,
      [emp]
    );
    out.conexoes = { abertas: Number(c.abertas), novas_hoje: Number(c.novas) };
  } catch (err) { console.warn("[dashboard] conexoes do dia:", err.message); }
  try {
    if (await temRecurso(emp, "whatsapp")) {
      const [[a]] = await db.query("SELECT COALESCE(SUM(status = 'aberta'), 0) AS abertas, COALESCE(SUM(nao_lidas), 0) AS nao_lidas FROM whatsapp_conversas WHERE empresa_id = ?", [emp]);
      const [[m]] = await db.query(
        "SELECT COALESCE(SUM(direcao = 'in'), 0) AS recebidas, COALESCE(SUM(direcao = 'out'), 0) AS enviadas FROM whatsapp_mensagens WHERE empresa_id = ? AND criado_em >= CURDATE()",
        [emp]
      );
      out.whatsapp = { abertas: Number(a.abertas), nao_lidas: Number(a.nao_lidas), recebidas_hoje: Number(m.recebidas), enviadas_hoje: Number(m.enviadas) };
    }
  } catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.warn("[dashboard] whatsapp do dia:", err.message); }
  res.json(out);
};
