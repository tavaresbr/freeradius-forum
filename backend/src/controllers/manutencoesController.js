// Manutencoes programadas (WhatsApp): CRUD, previa do publico e cancelamento. Os avisos sao enviados por
// src/jobs/manutencoes.js, que cria envios na fila de promocoes (tipo 'aviso') consumida por jobs/enviaPromocoes.js.
const db = require("../../db");
const m = require("../utils/manutencao");
const pub = require("../utils/manutencaoPublico");
const { mascararTelefone } = require("../utils/promocaoWhatsapp");

const MSG_MIGRATION = "Recurso indisponível: rode a migration 064 (node migrations/064_manutencoes.js).";
const erro500 = (res, err, msg) => { console.error(`[manutencoes] ${msg}:`, err.message); res.status(500).json({ error: msg }); };
const semTabela = (err) => err && err.code === "ER_NO_SUCH_TABLE";

async function equipamentoValido(empresaId, id) {
  if (!id) return true;
  const [[e]] = await db.query("SELECT id FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, empresaId]);
  return !!e;
}
/** true se `inicio` (DATETIME string) ainda nao passou segundo o relogio do MySQL (o mesmo do job). */
async function noFuturo(inicio) {
  const [[r]] = await db.query("SELECT TIMESTAMPDIFF(MINUTE, NOW(), ?) AS min", [inicio]);
  return Number(r?.min) >= 0;
}
const cru = (row) => ({ ...row, antecedencias: (() => { try { return JSON.parse(row.antecedencias); } catch { return []; } })(), aviso_fim: !!row.aviso_fim, avisar_clientes: !!row.avisar_clientes });

// GET /api/atendimento/manutencoes?quando=futuras|passadas
exports.listar = async (req, res) => {
  try {
    const passadas = req.query.quando === "passadas";
    const [rows] = await db.query(
      `SELECT mt.*, mk.nome AS equipamento_nome,
              (SELECT COALESCE(SUM(pe.enviados), 0) FROM manutencao_avisos a JOIN promocao_envios pe ON pe.id = a.envio_id WHERE a.manutencao_id = mt.id) AS enviados,
              (SELECT COALESCE(SUM(pe.total), 0) FROM manutencao_avisos a JOIN promocao_envios pe ON pe.id = a.envio_id WHERE a.manutencao_id = mt.id) AS destinatarios
         FROM manutencoes mt LEFT JOIN mikrotiks mk ON mk.id = mt.equipamento_id AND mk.empresa_id = mt.empresa_id
        WHERE mt.empresa_id = ? AND ${passadas ? "(mt.fim_em < NOW() OR mt.status IN ('concluida','cancelada'))" : "(mt.fim_em >= NOW() AND mt.status IN ('agendada','em_andamento'))"}
        ORDER BY mt.inicio_em ${passadas ? "DESC" : "ASC"} LIMIT 100`,
      [req.empresa_id]
    );
    res.json({ pronto: true, manutencoes: rows.map((r) => ({ ...cru(r), enviados: Number(r.enviados), destinatarios: Number(r.destinatarios) })), antecedencias: m.ANTECEDENCIAS });
  } catch (err) {
    if (semTabela(err)) return res.json({ pronto: false, manutencoes: [], antecedencias: m.ANTECEDENCIAS, aviso: MSG_MIGRATION });
    erro500(res, err, "Erro ao listar as manutenções");
  }
};

// POST /api/atendimento/manutencoes/previa { equipamento_id, janela_dias }
exports.previa = async (req, res) => {
  try {
    const eq = req.body?.equipamento_id ? Number(req.body.equipamento_id) : null;
    if (eq !== null && (!Number.isInteger(eq) || eq <= 0)) return res.status(400).json({ error: "Equipamento inválido" });
    if (!(await equipamentoValido(req.empresa_id, eq))) return res.status(400).json({ error: "Equipamento inválido" });
    const sel = await pub.selecionarPublico(db, req.empresa_id, eq, req.body?.janela_dias);
    res.json({
      total: sel.destinatarios.length, invalidos: sel.invalidos, duplicados: sel.duplicados, bloqueados: sel.bloqueados, excedeu: sel.excedeu, limite: sel.limite,
      amostra: sel.destinatarios.slice(0, 5).map((d) => ({ nome: d.nome, telefone: mascararTelefone(d.telefone) })),
    });
  } catch (err) { erro500(res, err, "Erro ao calcular o público"); }
};

async function gravar(req, res, id) {
  const v = m.validarManutencao(req.body);
  if (!v.ok) return res.status(400).json({ error: v.erro });
  const x = v.valor;
  if (!(await equipamentoValido(req.empresa_id, x.equipamento_id))) return res.status(400).json({ error: "Equipamento inválido" });
  if (!(await noFuturo(x.inicio_em))) return res.status(400).json({ error: "O início deve ser no futuro" });
  const campos = [x.titulo, x.mensagem, x.mensagem_fim || null, x.equipamento_id, x.inicio_em, x.fim_em, JSON.stringify(x.antecedencias), x.aviso_fim ? 1 : 0, x.avisar_clientes ? 1 : 0, x.janela_dias];
  if (id) {
    const [r] = await db.query(
      `UPDATE manutencoes SET titulo = ?, mensagem = ?, mensagem_fim = ?, equipamento_id = ?, inicio_em = ?, fim_em = ?, antecedencias = ?, aviso_fim = ?, avisar_clientes = ?, janela_dias = ?
        WHERE id = ? AND empresa_id = ? AND status = 'agendada'
          AND NOT EXISTS (SELECT 1 FROM manutencao_avisos a WHERE a.manutencao_id = manutencoes.id)`,
      [...campos, id, req.empresa_id]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Só dá para editar uma manutenção agendada que ainda não enviou avisos. Cancele e crie outra." });
    return res.json({ success: true });
  }
  const [r] = await db.query(
    `INSERT INTO manutencoes (titulo, mensagem, mensagem_fim, equipamento_id, inicio_em, fim_em, antecedencias, aviso_fim, avisar_clientes, janela_dias, empresa_id, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...campos, req.empresa_id, req.user?.id || null]
  );
  res.status(201).json({ success: true, id: r.insertId });
}

// POST /api/atendimento/manutencoes  |  PUT /api/atendimento/manutencoes/:id
exports.criar = async (req, res) => {
  try { await gravar(req, res, null); }
  catch (err) { if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION }); erro500(res, err, "Erro ao criar a manutenção"); }
};
exports.atualizar = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido" });
  try { await gravar(req, res, id); }
  catch (err) { if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION }); erro500(res, err, "Erro ao salvar a manutenção"); }
};

// POST /api/atendimento/manutencoes/:id/cancelar -> para de avisar e pausa o que estiver na fila
exports.cancelar = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const [r] = await db.query("UPDATE manutencoes SET status = 'cancelada' WHERE id = ? AND empresa_id = ? AND status IN ('agendada','em_andamento')", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Manutenção não encontrada ou já encerrada" });
    await db.query(
      `UPDATE promocao_envios SET status = 'cancelada' WHERE empresa_id = ? AND status IN ('em_andamento','pausada','rascunho')
          AND id IN (SELECT envio_id FROM manutencao_avisos WHERE manutencao_id = ? AND envio_id IS NOT NULL)`,
      [req.empresa_id, id]
    );
    res.json({ success: true });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao cancelar");
  }
};
