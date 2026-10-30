// Nao perturbe (WhatsApp): lista central de telefones sem mensagens proativas + horario de silencio.
const db = require("../../db");
const auto = require("../services/whatsappAutomacao");
const silencio = require("../utils/silencio");
const naoPerturbe = require("../utils/naoPerturbe");
const { normalizarTelefone } = require("../services/whatsappNotify");

const POR_PAGINA = 50;
const MAX_IMPORTAR = 5000;
const MSG_MIGRATION = "Recurso indisponível: rode a migration 063 (node migrations/063_whatsapp_nao_perturbe.js).";

const erro500 = (res, err, msg) => { console.error(`[nao-perturbe] ${msg}:`, err.message); res.status(500).json({ error: msg }); };
const semTabela = (err) => err && err.code === "ER_NO_SUCH_TABLE";
const mascarar = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length >= 4 ? `${d.slice(0, 4)}****${d.slice(-2)}` : d; };

// GET /api/atendimento/nao-perturbe/config
exports.obterConfig = async (req, res) => {
  try {
    const cfg = await auto.lerConfigJson(req.empresa_id);
    res.json({ config: silencio.mesclarComPadrao(cfg.nao_perturbe), tipos: silencio.TIPOS });
  } catch (err) { erro500(res, err, "Erro ao buscar o horário de silêncio"); }
};

// PUT /api/atendimento/nao-perturbe/config { ativo, fuso, de, ate, dias, aplicar_a }
exports.salvarConfig = async (req, res) => {
  try {
    const cfg = silencio.validarSilencio(req.body);
    await auto.salvarChave(req.empresa_id, "nao_perturbe", cfg);
    res.json({ success: true, config: cfg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao salvar o horário de silêncio");
  }
};

// GET /api/atendimento/nao-perturbe?q=&pagina=
exports.listar = async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const q = String(req.query.q || "").replace(/\D/g, "").slice(0, 20);
    const where = ["empresa_id = ?"];
    const params = [req.empresa_id];
    if (q.length >= 3) { where.push("telefone LIKE ?"); params.push(`%${q}%`); }
    const [[tot]] = await db.query(`SELECT COUNT(*) AS n FROM whatsapp_nao_perturbe WHERE ${where.join(" AND ")}`, params);
    const [itens] = await db.query(
      `SELECT id, telefone, motivo, origem, criado_em FROM whatsapp_nao_perturbe WHERE ${where.join(" AND ")}
        ORDER BY id DESC LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`, params);
    const [porOrigem] = await db.query("SELECT origem, COUNT(*) AS n FROM whatsapp_nao_perturbe WHERE empresa_id = ? GROUP BY origem", [req.empresa_id]);
    const [[leads]] = await db.query("SELECT COUNT(*) AS n FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1", [req.empresa_id]).catch(() => [[{ n: 0 }]]);
    res.json({
      pronto: true,
      total: Number(tot.n), pagina, por_pagina: POR_PAGINA,
      itens: itens.map((i) => ({ ...i, telefone_mascarado: mascarar(i.telefone) })),
      resumo: { ...Object.fromEntries(porOrigem.map((r) => [r.origem, Number(r.n)])), clientes_optout: Number(leads.n) },
    });
  } catch (err) {
    if (semTabela(err)) return res.json({ pronto: false, itens: [], total: 0, resumo: {}, aviso: MSG_MIGRATION });
    erro500(res, err, "Erro ao listar");
  }
};

// POST /api/atendimento/nao-perturbe { telefone, motivo? }
exports.adicionar = async (req, res) => {
  try {
    const tel = normalizarTelefone(req.body?.telefone);
    if (!tel) return res.status(400).json({ error: "Telefone inválido (use DDD + número)" });
    const [r] = await db.query(
      "INSERT IGNORE INTO whatsapp_nao_perturbe (empresa_id, telefone_fim10, telefone, motivo, origem) VALUES (?, ?, ?, ?, 'manual')",
      [req.empresa_id, naoPerturbe.fim10(tel), tel, String(req.body?.motivo || "").trim().slice(0, 120) || null]
    );
    res.json({ success: true, adicionado: r.affectedRows > 0 });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao adicionar");
  }
};

// DELETE /api/atendimento/nao-perturbe/:id
exports.remover = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido" });
    const [r] = await db.query("DELETE FROM whatsapp_nao_perturbe WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Não encontrado" });
    res.json({ success: true });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao remover");
  }
};

// POST /api/atendimento/nao-perturbe/importar { telefones: [...] } (ate 5000)
exports.importar = async (req, res) => {
  try {
    const lista = Array.isArray(req.body?.telefones) ? req.body.telefones : null;
    if (!lista) return res.status(400).json({ error: "Envie a lista de telefones" });
    if (lista.length > MAX_IMPORTAR) return res.status(400).json({ error: `Máximo de ${MAX_IMPORTAR} telefones por importação` });
    const vistos = new Set();
    const validos = [];
    let invalidos = 0;
    for (const t of lista) {
      const n = normalizarTelefone(typeof t === "string" || typeof t === "number" ? t : "");
      if (!n) { invalidos++; continue; }
      const f = naoPerturbe.fim10(n);
      if (vistos.has(f)) continue;
      vistos.add(f);
      validos.push([req.empresa_id, f, n, "Importado", "importado"]);
    }
    let adicionados = 0;
    for (let i = 0; i < validos.length; i += 500) {
      const lote = validos.slice(i, i + 500);
      const [r] = await db.query("INSERT IGNORE INTO whatsapp_nao_perturbe (empresa_id, telefone_fim10, telefone, motivo, origem) VALUES ?", [lote]);
      adicionados += r.affectedRows;
    }
    res.json({ success: true, adicionados, repetidos: validos.length - adicionados, invalidos });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao importar");
  }
};

// GET /api/atendimento/nao-perturbe/export -> CSV (telefone, motivo, origem, data)
exports.exportar = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT telefone, motivo, origem, criado_em FROM whatsapp_nao_perturbe WHERE empresa_id = ? ORDER BY id DESC LIMIT 50000", [req.empresa_id]);
    const cel = (v) => { const s = String(v ?? "").replace(/"/g, '""'); return `"${/^[=+\-@\t\r]/.test(s) ? "'" + s : s}"`; };
    const csv = ["telefone;motivo;origem;data", ...rows.map((r) => [r.telefone, r.motivo, r.origem, r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em].map(cel).join(";"))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="nao-perturbe.csv"');
    res.send("﻿" + csv);
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao exportar");
  }
};
