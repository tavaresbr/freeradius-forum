const db = require("../../db");
const { ehDonoPlataforma, limparCacheDono } = require("../utils/donoPlataforma");
const {
  periodoValido, preencherSerieDias, preencherSerieMeses, inicioSerieMeses, taxaConversao, mrrDeAssinaturas, soma,
} = require("../utils/metricasPlataforma");

// Qualquer usuario autenticado: o front usa para mostrar/esconder as areas da plataforma.
exports.eu = async (req, res) => {
  try {
    res.json({ dono: await ehDonoPlataforma(req.user.id, req.user.role) });
  } catch (err) {
    console.error("[plataforma] eu:", err.message);
    res.json({ dono: false });
  }
};

// Dono: lista os super admins e quem tem o perfil.
exports.listarDonos = async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT id, email, nome, dono_plataforma FROM admins WHERE role = 'super_admin' ORDER BY id");
    res.json(rows.map((a) => ({ id: a.id, email: a.email, nome: a.nome, dono: Number(a.dono_plataforma) === 1 })));
  } catch (err) {
    console.error("[plataforma] listarDonos:", err.message);
    res.status(500).json({ message: "Erro ao listar. Rode a migration 042." });
  }
};

// Dono: da ou remove o perfil. Alvo precisa ser super_admin; nunca remove o ultimo dono.
exports.definirDono = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const dono = req.body && req.body.dono === true;
    if (!id) return res.status(400).json({ message: "Usuário inválido." });
    const [[alvo]] = await db.execute("SELECT id, dono_plataforma FROM admins WHERE id = ? AND role = 'super_admin'", [id]);
    if (!alvo) return res.status(404).json({ message: "Só super admins podem receber este perfil." });
    if (!dono && Number(alvo.dono_plataforma) === 1) {
      const [[r]] = await db.execute("SELECT COUNT(*) AS n FROM admins WHERE dono_plataforma = 1 AND role = 'super_admin'");
      if (r.n <= 1) return res.status(409).json({ message: "Não é possível remover o último dono da plataforma." });
    }
    await db.execute("UPDATE admins SET dono_plataforma = ? WHERE id = ?", [dono ? 1 : 0, id]);
    limparCacheDono();
    res.json({ message: dono ? "Perfil de dono concedido." : "Perfil de dono removido." });
  } catch (err) {
    console.error("[plataforma] definirDono:", err.message);
    res.status(500).json({ message: "Erro ao salvar. Rode a migration 042." });
  }
};

// ---------------------------------------------------------------------------
// Dono: metricas de negocio da plataforma (receita, crescimento, uso). Cada bloco falha sozinho
// (tabela/coluna ausente ou erro de um SELECT nao derruba os outros) e a resposta fica 2 min em cache.
// Unidades: assinatura_cobrancas.valor em REAIS; pagamentos.valor em CENTAVOS (convertido aqui).
// ---------------------------------------------------------------------------
const MESES_SERIE = 6;
const CACHE_METRICAS_MS = 2 * 60 * 1000;
const cacheMetricas = new Map();

async function bloco(nome, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[plataforma] metricas.${nome}:`, err.message);
    return null;
  }
}

const linhas = async (sql, params = []) => (await db.query(sql, params))[0];
const primeira = async (sql, params = []) => (await linhas(sql, params))[0] || {};

exports.metricas = async (req, res) => {
  try {
    const dias = periodoValido(req.query.dias);
    const hit = cacheMetricas.get(dias);
    if (hit && Date.now() - hit.em < CACHE_METRICAS_MS) return res.json(hit.dados);

    const agora = new Date();
    const desde = inicioSerieMeses(MESES_SERIE, agora);

    const [receita, crescimento, uso] = await Promise.all([
      bloco("receita", async () => {
        const porMes = await linhas(
          `SELECT DATE_FORMAT(pago_em, '%Y-%m') AS mes, SUM(valor) AS total FROM assinatura_cobrancas
            WHERE status = 'aprovada' AND pago_em >= ? GROUP BY mes`, [desde]);
        const per = await primeira(
          `SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*) AS n FROM assinatura_cobrancas
            WHERE status = 'aprovada' AND pago_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias]);
        const porPlano = await linhas(
          `SELECT COALESCE(sp.nome, 'Adicionais e outros') AS nome, SUM(c.valor) AS total, COUNT(*) AS n
             FROM assinatura_cobrancas c LEFT JOIN saas_planos sp ON sp.id = c.plano_id
            WHERE c.status = 'aprovada' AND c.pago_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY nome ORDER BY total DESC`, [dias]);
        const ativas = await linhas(
          `SELECT a.status, sp.* FROM assinaturas a JOIN saas_planos sp ON sp.id = a.plano_id WHERE a.status = 'ativa'`);
        const n = Number(per.n) || 0;
        const faturado = Number(per.total) || 0;
        return {
          mrr: mrrDeAssinaturas(ativas),
          faturado_periodo: faturado,
          pagamentos_periodo: n,
          ticket_medio: n ? Math.round((faturado / n) * 100) / 100 : 0,
          por_mes: preencherSerieMeses(porMes, MESES_SERIE, agora),
          por_plano: porPlano.map((p) => ({ nome: p.nome, total: Number(p.total) || 0, n: Number(p.n) || 0 })),
        };
      }),

      bloco("crescimento", async () => {
        const porMes = await linhas(
          `SELECT DATE_FORMAT(criado_em, '%Y-%m') AS mes, COUNT(*) AS total FROM empresas WHERE criado_em >= ? GROUP BY mes`, [desde]);
        const novas = await primeira(
          `SELECT COUNT(*) AS criadas,
                  COALESCE(SUM(EXISTS(SELECT 1 FROM assinatura_cobrancas c WHERE c.empresa_id = e.id AND c.status = 'aprovada')), 0) AS convertidas
             FROM empresas e WHERE e.criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias]);
        const trials = await primeira(`SELECT COUNT(*) AS n FROM assinaturas WHERE status = 'trial'`);
        const vencidos = await primeira(
          `SELECT COUNT(*) AS n FROM assinaturas a WHERE a.status = 'vencida'
              AND NOT EXISTS (SELECT 1 FROM assinatura_cobrancas c WHERE c.empresa_id = a.empresa_id AND c.status = 'aprovada')`);
        const cancel = await primeira(
          `SELECT COUNT(*) AS n FROM assinaturas WHERE status = 'cancelada' AND atualizado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias]);
        return {
          empresas_novas_periodo: Number(novas.criadas) || 0,
          empresas_por_mes: preencherSerieMeses(porMes, MESES_SERIE, agora),
          trials_ativos: Number(trials.n) || 0,
          conversao: taxaConversao(novas.criadas, novas.convertidas),
          trials_vencidos_sem_pagar: Number(vencidos.n) || 0,
          cancelamentos_periodo: Number(cancel.n) || 0,
        };
      }),

      bloco("uso", async () => {
        const leads = await primeira(
          `SELECT COUNT(*) AS total, COALESCE(SUM(criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)), 0) AS novos FROM leads`, [dias]);
        const porDia = await linhas(
          `SELECT DATE_FORMAT(acctstarttime, '%Y-%m-%d') AS dia, COUNT(*) AS total FROM radacct
            WHERE acctstarttime >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY dia`, [dias]);
        const agoraRad = await primeira(
          `SELECT COUNT(*) AS n FROM radacct WHERE acctstoptime IS NULL AND acctstarttime >= DATE_SUB(NOW(), INTERVAL 1 DAY)`);
        const vendas = await primeira(
          `SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS centavos FROM pagamentos
            WHERE status = 'approved' AND criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [dias]);
        const top = await linhas(
          `SELECT e.id, e.nome, COALESCE(v.n, 0) AS vendas, COALESCE(v.centavos, 0) AS centavos, COALESCE(l.n, 0) AS leads
             FROM empresas e
             LEFT JOIN (SELECT empresa_id, COUNT(*) AS n, SUM(valor) AS centavos FROM pagamentos
                         WHERE status = 'approved' AND criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY empresa_id) v ON v.empresa_id = e.id
             LEFT JOIN (SELECT empresa_id, COUNT(*) AS n FROM leads
                         WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY empresa_id) l ON l.empresa_id = e.id
            ORDER BY centavos DESC, leads DESC LIMIT 5`, [dias, dias]);
        const serie = preencherSerieDias(porDia, dias, agora);
        return {
          leads_total: Number(leads.total) || 0,
          leads_novos_periodo: Number(leads.novos) || 0,
          conexoes_periodo: soma(serie),
          conexoes_por_dia: serie,
          conectados_agora: Number(agoraRad.n) || 0,
          vendas_hotspot: { n: Number(vendas.n) || 0, valor: (Number(vendas.centavos) || 0) / 100 },
          top_empresas: top
            .filter((t) => Number(t.vendas) > 0 || Number(t.leads) > 0)
            .map((t) => ({ id: t.id, nome: t.nome, vendas: Number(t.vendas) || 0, valor: (Number(t.centavos) || 0) / 100, leads: Number(t.leads) || 0 })),
        };
      }),
    ]);

    const dados = { dias, receita, crescimento, uso };
    cacheMetricas.set(dias, { em: Date.now(), dados });
    res.json(dados);
  } catch (err) {
    console.error("[plataforma] metricas:", err.message);
    res.status(500).json({ message: "Erro ao calcular métricas" });
  }
};
