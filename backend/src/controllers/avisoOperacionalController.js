// Aviso operacional por WhatsApp (admin): previa, criar fila e listar. Iniciar/pausar/retomar/cancelar/obter reaproveitam
// o controller de promocoes (mesma fila e mesmo worker). O envio e' feito por src/jobs/enviaPromocoes.js.
const db = require("../../db");
const { instanciaConectada, enviarMensagemEstrita } = require("./whatsappController");
const { normalizarTelefone } = require("../services/whatsappNotify");
const { temColuna } = require("../utils/schemaCache");
const { mascararTelefone } = require("../utils/promocaoWhatsapp");
const a = require("../utils/avisoOperacional");

const MSG_MIGRATION = "Recurso indisponível: rode a migration 057 (node migrations/057_promocao_envios_tipo.js).";

async function equipamentoValido(empresaId, equipamentoId) {
  if (!equipamentoId) return true;
  const [[m]] = await db.query("SELECT id FROM mikrotiks WHERE id = ? AND empresa_id = ?", [equipamentoId, empresaId]);
  return !!m;
}

exports.previa = async (req, res) => {
  const v = a.validarAviso({ ...req.body, mensagem: req.body?.mensagem });
  if (!v.ok) return res.status(400).json({ error: v.erro });
  try {
    if (!(await equipamentoValido(req.empresa_id, v.equipamento_id))) return res.status(400).json({ error: "Equipamento inválido" });
    const sel = await a.selecionarConectados(db, req.empresa_id, v.equipamento_id);
    res.json({
      success: true,
      data: {
        total: sel.destinatarios.length, invalidos: sel.invalidos, duplicados: sel.duplicados, excedeu: sel.excedeu, limite: sel.limite,
        amostra: sel.destinatarios.slice(0, 5).map((d) => ({ nome: d.nome, telefone: mascararTelefone(d.telefone) })),
        mensagem_exemplo: a.montarMensagemAviso(v.mensagem, sel.destinatarios[0]?.nome),
      },
    });
  } catch (err) {
    console.error("[aviso-operacional] previa:", err.message);
    res.status(500).json({ error: "Erro ao calcular a prévia" });
  }
};

exports.criar = async (req, res) => {
  const v = a.validarAviso(req.body);
  if (!v.ok) return res.status(400).json({ error: v.erro });
  try {
    if (!(await temColuna("promocao_envios", "tipo"))) return res.status(503).json({ error: MSG_MIGRATION });
    if (!(await equipamentoValido(req.empresa_id, v.equipamento_id))) return res.status(400).json({ error: "Equipamento inválido" });
    const sel = await a.selecionarConectados(db, req.empresa_id, v.equipamento_id);
    if (!sel.destinatarios.length) return res.status(400).json({ error: "Nenhum cliente conectado agora com telefone cadastrado" });
    const [r] = await db.execute(
      `INSERT INTO promocao_envios (empresa_id, nome, tipo, mensagem, filtros_json, status, total, criado_por)
       VALUES (?, ?, 'aviso', ?, ?, 'rascunho', ?, ?)`,
      [req.empresa_id, v.nome, v.mensagem, JSON.stringify({ equipamento_id: v.equipamento_id }), sel.destinatarios.length, req.user?.id || null]
    );
    const envioId = r.insertId;
    await db.query(
      "INSERT INTO promocao_destinatarios (envio_id, empresa_id, lead_id, telefone, nome) VALUES ?",
      [sel.destinatarios.map((d) => [envioId, req.empresa_id, d.lead_id, d.telefone, d.nome])]
    );
    const [[envio]] = await db.execute("SELECT * FROM promocao_envios WHERE id = ? AND empresa_id = ?", [envioId, req.empresa_id]);
    res.status(201).json({ success: true, data: envio });
  } catch (err) {
    console.error("[aviso-operacional] criar:", err.message);
    res.status(500).json({ error: "Erro ao criar o aviso" });
  }
};

exports.listar = async (req, res) => {
  try {
    if (!(await temColuna("promocao_envios", "tipo"))) return res.json({ success: true, data: [], indisponivel: true });
    const [rows] = await db.execute(
      "SELECT id, nome, status, total, enviados, falhas, ignorados, criado_em, iniciado_em, concluido_em FROM promocao_envios WHERE empresa_id = ? AND tipo = 'aviso' ORDER BY id DESC LIMIT 50",
      [req.empresa_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[aviso-operacional] listar:", err.message);
    res.status(500).json({ error: "Erro ao listar os avisos" });
  }
};

// Envia o aviso (sem fila) para UM numero, para o admin conferir antes de disparar.
exports.testar = async (req, res) => {
  const v = a.validarAviso(req.body);
  if (!v.ok) return res.status(400).json({ error: v.erro });
  const tel = normalizarTelefone(req.body?.telefone);
  if (!tel) return res.status(400).json({ error: "Telefone inválido (use DDD + número)" });
  try {
    if (!(await instanciaConectada(req.empresa_id))) return res.status(409).json({ error: "O WhatsApp da empresa não está conectado." });
    await enviarMensagemEstrita(tel, `[TESTE] ${a.montarMensagemAviso(v.mensagem, "Cliente Teste")}`, req.empresa_id);
    res.json({ success: true });
  } catch (err) {
    console.error("[aviso-operacional] teste:", err.message);
    res.status(502).json({ error: "Não foi possível enviar o teste. Confira a conexão do WhatsApp." });
  }
};
