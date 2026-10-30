// Alertas tecnicos (WhatsApp): feed, config, alerta manual e aviso aos clientes. O registro automatico vem de
// jobs/alertaEquipamentos.js (via services/alertasTecnicos.js); o envio aos clientes usa a fila de avisos.
const db = require("../../db");
const auto = require("../services/whatsappAutomacao");
const svc = require("../services/alertasTecnicos");
const at = require("../utils/alertaTecnico");
const pub = require("../utils/manutencaoPublico");
const { instanciaConectada } = require("./whatsappController");
const { mascararTelefone } = require("../utils/promocaoWhatsapp");

const POR_PAGINA = 50;
const MSG_MIGRATION = "Recurso indisponível: rode a migration 065 (node migrations/065_alertas_tecnicos.js).";
const erro500 = (res, err, msg) => { console.error(`[alertas-tecnicos] ${msg}:`, err.message); res.status(500).json({ error: msg }); };
const semTabela = (err) => err && err.code === "ER_NO_SUCH_TABLE";
const idParam = (req) => { const n = parseInt(req.params.id, 10); return Number.isInteger(n) ? n : null; };

// GET /api/atendimento/alertas-tecnicos/config
exports.obterConfig = async (req, res) => {
  try { res.json({ config: at.mesclarComPadrao((await auto.lerConfigJson(req.empresa_id)).alertas_tecnicos) }); }
  catch (err) { erro500(res, err, "Erro ao buscar a configuração"); }
};

// PUT /api/atendimento/alertas-tecnicos/config
exports.salvarConfig = async (req, res) => {
  try {
    const cfg = at.validarConfig(req.body);
    await auto.salvarChave(req.empresa_id, "alertas_tecnicos", cfg);
    res.json({ success: true, config: cfg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao salvar a configuração");
  }
};

// GET /api/atendimento/alertas-tecnicos?estado=abertos|resolvidos|todos&equipamento_id=&pagina=
exports.listar = async (req, res) => {
  try {
    const estado = ["abertos", "resolvidos"].includes(req.query.estado) ? req.query.estado : "todos";
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const where = ["a.empresa_id = ?"];
    const params = [req.empresa_id];
    if (estado === "abertos") where.push("a.resolvido_em IS NULL");
    if (estado === "resolvidos") where.push("a.resolvido_em IS NOT NULL");
    const eq = parseInt(req.query.equipamento_id, 10);
    if (Number.isInteger(eq)) { where.push("a.equipamento_id = ?"); params.push(eq); }
    const [itens] = await db.query(
      `SELECT a.id, a.tipo, a.equipamento_id, a.severidade, a.titulo, a.detalhes, a.criado_em, a.resolvido_em,
              a.clientes_avisados_em, a.clientes_volta_avisados_em, mk.nome AS equipamento_nome,
              TIMESTAMPDIFF(MINUTE, a.criado_em, COALESCE(a.resolvido_em, NOW())) AS duracao_min
         FROM alertas_tecnicos a LEFT JOIN mikrotiks mk ON mk.id = a.equipamento_id AND mk.empresa_id = a.empresa_id
        WHERE ${where.join(" AND ")} ORDER BY a.criado_em DESC, a.id DESC LIMIT ${POR_PAGINA + 1} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      params
    );
    const [[off]] = await db.query("SELECT COUNT(*) AS n FROM alertas_tecnicos WHERE empresa_id = ? AND tipo = 'equipamento_offline' AND resolvido_em IS NULL", [req.empresa_id]);
    const cfg = at.mesclarComPadrao((await auto.lerConfigJson(req.empresa_id)).alertas_tecnicos);
    res.json({ pronto: true, itens: itens.slice(0, POR_PAGINA), tem_mais: itens.length > POR_PAGINA, pagina, offline_agora: Number(off.n), config: cfg });
  } catch (err) {
    if (semTabela(err)) return res.json({ pronto: false, itens: [], offline_agora: 0, aviso: MSG_MIGRATION });
    erro500(res, err, "Erro ao listar os alertas");
  }
};

// POST /api/atendimento/alertas-tecnicos { titulo, detalhes?, equipamento_id? } -> alerta manual (incidente registrado pela equipe)
exports.criarManual = async (req, res) => {
  try {
    const titulo = String(req.body?.titulo || "").trim();
    const detalhes = String(req.body?.detalhes || "").trim();
    if (!titulo) return res.status(400).json({ error: "Informe o título do alerta" });
    if (titulo.length > 150) return res.status(400).json({ error: "O título deve ter no máximo 150 caracteres" });
    if (detalhes.length > 500) return res.status(400).json({ error: "Os detalhes devem ter no máximo 500 caracteres" });
    let equipamentoId = null;
    if (req.body?.equipamento_id) {
      equipamentoId = Number(req.body.equipamento_id);
      const [[e]] = Number.isInteger(equipamentoId) ? await db.query("SELECT id FROM mikrotiks WHERE id = ? AND empresa_id = ?", [equipamentoId, req.empresa_id]) : [[null]];
      if (!e) return res.status(400).json({ error: "Equipamento inválido" });
    }
    const [r] = await db.query(
      "INSERT INTO alertas_tecnicos (empresa_id, tipo, equipamento_id, severidade, titulo, detalhes, criado_por) VALUES (?, 'manual', ?, 'media', ?, ?, ?)",
      [req.empresa_id, equipamentoId, titulo, detalhes || null, req.user?.id || null]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao criar o alerta");
  }
};

// POST /api/atendimento/alertas-tecnicos/:id/resolver (so alertas manuais; os de equipamento se encerram sozinhos)
exports.resolver = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  try {
    const [r] = await db.query("UPDATE alertas_tecnicos SET resolvido_em = NOW() WHERE id = ? AND empresa_id = ? AND tipo = 'manual' AND resolvido_em IS NULL", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Alerta manual aberto não encontrado" });
    res.json({ success: true });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao encerrar o alerta");
  }
};

// GET /api/atendimento/alertas-tecnicos/:id/previa -> quantos clientes receberiam o aviso
exports.previa = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  try {
    const [[a]] = await db.query("SELECT id, equipamento_id, tipo FROM alertas_tecnicos WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!a) return res.status(404).json({ error: "Alerta não encontrado" });
    if (a.tipo !== "equipamento_offline" && a.tipo !== "manual") return res.status(400).json({ error: "Esse tipo de alerta não é avisado aos clientes" });
    const sel = await pub.selecionarPublico(db, req.empresa_id, a.equipamento_id, 30);
    res.json({ total: sel.destinatarios.length, bloqueados: sel.bloqueados, excedeu: sel.excedeu, limite: sel.limite,
      amostra: sel.destinatarios.slice(0, 5).map((d) => ({ nome: d.nome, telefone: mascararTelefone(d.telefone) })) });
  } catch (err) { erro500(res, err, "Erro ao calcular o público"); }
};

// POST /api/atendimento/alertas-tecnicos/:id/avisar-clientes { tipo: 'queda'|'volta', confirmar: true }
exports.avisarClientes = async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const tipo = req.body?.tipo === "volta" ? "volta" : "queda";
  if (req.body?.confirmar !== true) return res.status(400).json({ error: "Confirme o envio" });
  try {
    if (!(await instanciaConectada(req.empresa_id))) return res.status(409).json({ error: "O WhatsApp da empresa não está conectado." });
    const cfg = at.mesclarComPadrao((await auto.lerConfigJson(req.empresa_id)).alertas_tecnicos);
    const r = await svc.avisarClientes(req.empresa_id, id, tipo, cfg);
    if (!r.ok) {
      const msgs = { nao_encontrado: [404, "Alerta não encontrado"], tipo_sem_clientes: [400, "Esse tipo de alerta não é avisado aos clientes"], ainda_aberto: [409, "O alerta ainda está aberto: não há o que avisar sobre a volta"], ja_avisado: [409, "Os clientes já foram avisados deste alerta"] };
      const [st, texto] = msgs[r.motivo] || [400, "Não foi possível avisar"];
      return res.status(st).json({ error: texto });
    }
    if (!r.envio_id) return res.status(400).json({ error: "Nenhum cliente com telefone para avisar" });
    res.json({ success: true, envio_id: r.envio_id });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao avisar os clientes");
  }
};
