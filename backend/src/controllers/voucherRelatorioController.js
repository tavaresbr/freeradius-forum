// Relatorio de vouchers usados: lista detalhada, resumo por dia, por equipamento e por lote (+ CSV).
// Tudo escopado por empresa_id. Periodo = data de USO (usado_em), no maximo 366 dias.
const db = require("../../db");
const { celulaCsv } = require("../utils/voucher");
const { normalizarId } = require("../utils/entradaSegura");

const MAX_DIAS = 366;
const MAX_CSV = 10000;
const DIA_MS = 86400000;

function dataValida(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** { de, ate } (AAAA-MM-DD, inclusivos). Padrao: ultimos 30 dias. Retorna { erro } se invalido. */
function periodoRelatorio(q = {}, hoje = new Date()) {
  const ate = dataValida(q.ate) || hoje.toISOString().slice(0, 10);
  const de = dataValida(q.de) || new Date(Date.parse(`${ate}T00:00:00Z`) - 29 * DIA_MS).toISOString().slice(0, 10);
  if (de > ate) return { erro: "A data inicial não pode ser depois da final" };
  if ((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS > MAX_DIAS) return { erro: `Período máximo de ${MAX_DIAS} dias` };
  return { de, ate };
}

// Filtros comuns (empresa + equipamento + lote). `semLote=true` quando lote == "__sem__".
function filtrosBase(req) {
  const where = ["v.empresa_id = ?"];
  const params = [req.empresa_id];
  if (normalizarId(req.query.equipamento)) { where.push("v.mikrotik_id = ?"); params.push(Number(req.query.equipamento)); }
  const lote = req.query.lote;
  if (lote === "__sem__") where.push("v.lote IS NULL");
  else if (typeof lote === "string" && lote) { where.push("v.lote = ?"); params.push(lote.slice(0, 60)); }
  return { where, params };
}

const NO_PERIODO = "v.usado_em >= ? AND v.usado_em < DATE_ADD(?, INTERVAL 1 DAY)";

// Tempo consumido (s) por username no radacct (sessao aberta conta ate agora). Falha => sem dado.
async function consumoPorUsername(usernames) {
  const mapa = {};
  const unicos = [...new Set(usernames.filter(Boolean))];
  if (!unicos.length) return mapa;
  try {
    for (let i = 0; i < unicos.length; i += 500) {
      const lote = unicos.slice(i, i + 500);
      const [rows] = await db.query(
        `SELECT username, COALESCE(SUM(IF(acctstoptime IS NULL, TIMESTAMPDIFF(SECOND, acctstarttime, NOW()), acctsessiontime)), 0) AS usado
           FROM radacct WHERE username IN (${lote.map(() => "?").join(",")}) GROUP BY username`,
        lote
      );
      rows.forEach((r) => { mapa[r.username] = Number(r.usado) || 0; });
    }
  } catch (err) {
    console.warn("[vouchers] relatorio: radacct indisponivel:", err.message);
  }
  return mapa;
}

async function linhasDetalhe(req, per, { limit, offset }) {
  const { where, params } = filtrosBase(req);
  where.push("v.status = 'usado'", NO_PERIODO);
  const p = [...params, per.de, per.ate];
  const [rows] = await db.query(
    `SELECT v.id, v.codigo, v.lote, v.usado_em, v.usado_mac, v.usado_ip, v.username,
            pl.nome AS plano_nome, pl.duracao_minutos AS plano_minutos,
            m.nome AS equipamento_nome, mu.nome AS usado_equipamento
       FROM vouchers v
       LEFT JOIN planos pl ON pl.id = v.plano_id
       LEFT JOIN mikrotiks m ON m.id = v.mikrotik_id AND m.empresa_id = v.empresa_id
       LEFT JOIN radius_users ru ON ru.username = v.username AND ru.empresa_id = v.empresa_id
       LEFT JOIN mikrotiks mu ON mu.id = ru.nas_id AND mu.empresa_id = v.empresa_id
      WHERE ${where.join(" AND ")} ORDER BY v.usado_em DESC, v.id DESC LIMIT ? OFFSET ?`,
    [...p, limit, offset]
  );
  const consumo = await consumoPorUsername(rows.map((r) => r.username));
  return rows.map((r) => ({
    ...r,
    total_segundos: r.plano_minutos ? Number(r.plano_minutos) * 60 : null,
    consumido_segundos: Object.prototype.hasOwnProperty.call(consumo, r.username) ? consumo[r.username] : null,
  }));
}

exports.relatorio = async (req, res) => {
  try {
    const per = periodoRelatorio(req.query);
    if (per.erro) return res.status(400).json({ error: per.erro });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const { where, params } = filtrosBase(req);
    const wUsados = [...where, "v.status = 'usado'", NO_PERIODO].join(" AND ");
    const pUsados = [...params, per.de, per.ate];

    const [[tot]] = await db.query(`SELECT COUNT(*) AS n FROM vouchers v WHERE ${wUsados}`, pUsados);
    const [[geral]] = await db.query(
      `SELECT SUM(v.status = 'usado') AS usados, SUM(v.status = 'disponivel') AS disponiveis, SUM(v.status = 'cancelado') AS cancelados
         FROM vouchers v WHERE ${where.join(" AND ")}`, params
    );
    const [porDia] = await db.query(
      `SELECT DATE_FORMAT(v.usado_em, '%Y-%m-%d') AS dia, COUNT(*) AS n FROM vouchers v WHERE ${wUsados} GROUP BY dia ORDER BY dia`, pUsados
    );
    const colunasAgrupadas = `SUM(v.status = 'usado' AND ${NO_PERIODO}) AS usados_periodo, SUM(v.status = 'usado') AS usados_total,
              SUM(v.status = 'disponivel') AS disponiveis, SUM(v.status = 'cancelado') AS cancelados`;
    const [porEquip] = await db.query(
      `SELECT v.mikrotik_id AS equipamento_id, m.nome AS equipamento_nome, ${colunasAgrupadas}
         FROM vouchers v LEFT JOIN mikrotiks m ON m.id = v.mikrotik_id AND m.empresa_id = v.empresa_id
        WHERE ${where.join(" AND ")} GROUP BY v.mikrotik_id, m.nome ORDER BY usados_periodo DESC`,
      [per.de, per.ate, ...params]
    );
    const [porLote] = await db.query(
      `SELECT v.lote, ${colunasAgrupadas} FROM vouchers v WHERE ${where.join(" AND ")} GROUP BY v.lote ORDER BY usados_periodo DESC`,
      [per.de, per.ate, ...params]
    );
    const data = await linhasDetalhe(req, per, { limit, offset: (page - 1) * limit });

    const usadosGeral = Number(geral?.usados) || 0;
    const disponiveis = Number(geral?.disponiveis) || 0;
    const num = (r) => ({ ...r, usados_periodo: Number(r.usados_periodo) || 0, usados_total: Number(r.usados_total) || 0, disponiveis: Number(r.disponiveis) || 0, cancelados: Number(r.cancelados) || 0 });
    res.json({
      success: true, periodo: per,
      resumo: {
        usados_periodo: tot.n, usados_total: usadosGeral, disponiveis, cancelados: Number(geral?.cancelados) || 0,
        taxa_uso: usadosGeral + disponiveis > 0 ? Math.round((usadosGeral / (usadosGeral + disponiveis)) * 1000) / 10 : 0,
      },
      por_dia: porDia.map((d) => ({ dia: d.dia, n: Number(d.n) })),
      por_equipamento: porEquip.map(num),
      por_lote: porLote.map(num),
      data, total: tot.n, page, limit,
    });
  } catch (err) {
    console.error("[vouchers] relatorio:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR") return res.status(500).json({ error: "Atualização do banco pendente: rode as migrations 043 a 045 dos vouchers." });
    res.status(500).json({ error: "Erro ao gerar o relatório" });
  }
};

const hhmm = (s) => (s === null || s === undefined ? "" : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`);

exports.relatorioCSV = async (req, res) => {
  try {
    const per = periodoRelatorio(req.query);
    if (per.erro) return res.status(400).json({ error: per.erro });
    const rows = await linhasDetalhe(req, per, { limit: MAX_CSV, offset: 0 });
    const iso = (d) => (d ? new Date(d).toISOString() : "");
    const linhas = [["Codigo", "Plano", "Equipamento do voucher", "Usado no equipamento", "Lote", "Usado em", "MAC", "IP", "Tempo do plano", "Tempo consumido"].join(";")];
    rows.forEach((r) => linhas.push([r.codigo, r.plano_nome, r.equipamento_nome, r.usado_equipamento, r.lote, iso(r.usado_em), r.usado_mac, r.usado_ip, hhmm(r.total_segundos), hhmm(r.consumido_segundos)].map(celulaCsv).join(";")));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="vouchers-usados-${per.de}-a-${per.ate}.csv"`);
    res.send("﻿" + linhas.join("\n"));
  } catch (err) {
    console.error("[vouchers] relatorioCSV:", err.message);
    res.status(500).json({ error: "Erro ao exportar o relatório" });
  }
};

exports._periodoRelatorio = periodoRelatorio;
