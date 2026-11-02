// Aba "Grupos" do hub WhatsApp: grupos de cada numero, previa e importacao dos membros como clientes (com origem do grupo).
const svc = require("../services/whatsappGrupos");
const wnum = require("../utils/whatsappNumeros");

const erro = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : "Erro ao consultar os grupos" });
const numeroDe = (req) => { const n = parseInt(req.query.numero_id ?? req.body?.numero_id, 10); return Number.isInteger(n) && n > 0 ? n : 0; };
const jidDe = (req) => String(req.params.jid || "");
const csvCel = (v) => `"${String(v).replace(/"/g, '""')}"`;

exports.listar = async (req, res) => {
  try {
    const numeroId = numeroDe(req);
    if (numeroId && !(await wnum.obter(req.empresa_id, numeroId))) return res.status(400).json({ error: "Número de WhatsApp inválido" });
    const [grupos, importados] = await Promise.all([
      svc.listarGrupos(req.empresa_id, numeroId, { forcar: req.query.atualizar === "1" }),
      svc.importadosPorGrupo(req.empresa_id, numeroId),
    ]);
    res.json({ grupos: grupos.map((g) => ({ ...g, importado: importados.get(g.jid) || null })) });
  } catch (e) { erro(res, e); }
};

exports.previa = async (req, res) => {
  try { res.json(await svc.previa(req.empresa_id, numeroDe(req), jidDe(req))); } catch (e) { erro(res, e); }
};

exports.importar = async (req, res) => {
  try {
    if (req.body?.confirmar !== true) return res.status(400).json({ error: "Confirmação obrigatória" });
    res.json(await svc.importar(req.empresa_id, numeroDe(req), jidDe(req)));
  } catch (e) { erro(res, e); }
};

exports.exportar = async (req, res) => {
  try {
    const { nome, telefones } = await svc.exportarMembros(req.empresa_id, numeroDe(req), jidDe(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="membros-grupo.csv"');
    res.send("﻿telefone,grupo\r\n" + telefones.map((t) => `${csvCel("+" + t)},${csvCel(nome.replace(/^[=+\-@]/, "'$&"))}`).join("\r\n"));
  } catch (e) { erro(res, e); }
};

// Grupos dos quais ja se importou clientes (filtro "Origem" da aba Contatos). Sem a migration devolve vazio.
exports.origens = async (req, res) => {
  try {
    const db = require("../../db");
    const [rows] = await db.query("SELECT grupo_jid, MAX(grupo_nome) AS nome, COUNT(*) AS total FROM leads_origem_grupo WHERE empresa_id = ? GROUP BY grupo_jid ORDER BY nome", [req.empresa_id]);
    res.json({ grupos: rows.map((r) => ({ jid: r.grupo_jid, nome: r.nome, total: Number(r.total) })) });
  } catch { res.json({ grupos: [] }); }
};
