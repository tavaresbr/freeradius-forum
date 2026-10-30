// Alertas tecnicos: registro no feed (queda/volta de equipamento, WhatsApp desconectado) e aviso aos clientes.
// Todas as funcoes sao tolerantes a migration 065 ausente (nao lancam ER_NO_SUCH_TABLE) e escopadas por empresa.
const m = require("../utils/manutencao");
const at = require("../utils/alertaTecnico");
const avisoClientes = require("./avisoClientes");
const naoPerturbe = require("../utils/naoPerturbe");

const getDb = () => require("../../db");
const semTabela = (err) => err && err.code === "ER_NO_SUCH_TABLE";
async function seguro(fn) {
  try { return await fn(); } catch (err) { if (!semTabela(err)) console.error("[alertas-tecnicos]", err.message); return null; }
}

/** Abre um alerta se nao ha outro aberto do mesmo tipo/equipamento. true se criou. */
async function abrir(empresaId, { tipo, equipamentoId = null, titulo, detalhes = null, severidade = "alta", criadoPor = null }) {
  return seguro(async () => {
    const db = getDb();
    const [abertos] = await db.query(
      "SELECT id FROM alertas_tecnicos WHERE empresa_id = ? AND tipo = ? AND equipamento_id <=> ? AND resolvido_em IS NULL LIMIT 1",
      [empresaId, tipo, equipamentoId]
    );
    if (abertos.length) return false;
    await db.query(
      "INSERT INTO alertas_tecnicos (empresa_id, tipo, equipamento_id, severidade, titulo, detalhes, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [empresaId, tipo, equipamentoId, severidade, String(titulo).slice(0, 150), detalhes ? String(detalhes).slice(0, 500) : null, criadoPor]
    );
    return true;
  });
}

/** Encerra os alertas abertos do tipo/equipamento. Retorna quantos. */
async function resolver(empresaId, { tipo, equipamentoId = null }) {
  const r = await seguro(async () => {
    const [x] = await getDb().query(
      "UPDATE alertas_tecnicos SET resolvido_em = NOW() WHERE empresa_id = ? AND tipo = ? AND equipamento_id <=> ? AND resolvido_em IS NULL",
      [empresaId, tipo, equipamentoId]
    );
    return x.affectedRows;
  });
  return r || 0;
}

function mensagemDoAlerta(alerta, tec, nomeEquipamento, tipoAviso) {
  const modelo = tipoAviso === "volta" ? tec.mensagem_volta : tec.mensagem_queda;
  return m.renderizarMensagem(modelo, { inicio: alerta.criado_em, fim: alerta.resolvido_em, equipamento: nomeEquipamento });
}

/**
 * Avisa os clientes de UM alerta (tipo 'queda' | 'volta'). Reserva a coluna (1 aviso por alerta e tipo) e cria o envio.
 * Devolve { ok, envio_id, motivo }. Quem chama decide silencio/recurso; aqui so a reserva e a fila.
 */
async function avisarClientes(empresaId, alertaId, tipoAviso, tec) {
  const db = getDb();
  const coluna = tipoAviso === "volta" ? "clientes_volta_avisados_em" : "clientes_avisados_em";
  const [[alerta]] = await db.query("SELECT a.*, mk.nome AS equipamento_nome FROM alertas_tecnicos a LEFT JOIN mikrotiks mk ON mk.id = a.equipamento_id AND mk.empresa_id = a.empresa_id WHERE a.id = ? AND a.empresa_id = ?", [alertaId, empresaId]);
  if (!alerta) return { ok: false, motivo: "nao_encontrado" };
  if (alerta.tipo !== "equipamento_offline" && alerta.tipo !== "manual") return { ok: false, motivo: "tipo_sem_clientes" };
  if (tipoAviso === "volta" && !alerta.resolvido_em) return { ok: false, motivo: "ainda_aberto" };
  const [claim] = await db.query(`UPDATE alertas_tecnicos SET ${coluna} = NOW() WHERE id = ? AND empresa_id = ? AND ${coluna} IS NULL`, [alertaId, empresaId]);
  if (!claim.affectedRows) return { ok: false, motivo: "ja_avisado" };
  try {
    const envioId = await avisoClientes.criarEnvioAviso(db, {
      empresaId, equipamentoId: alerta.equipamento_id, janelaDias: 30,
      nome: `Alerta técnico: ${alerta.titulo}`, mensagem: mensagemDoAlerta(alerta, tec, alerta.equipamento_nome, tipoAviso),
      filtros: { origem: "alerta", alerta_id: alertaId, aviso: tipoAviso },
    });
    if (!envioId) return { ok: true, envio_id: null, motivo: "sem_publico" };
    return { ok: true, envio_id: envioId };
  } catch (err) {
    await db.query(`UPDATE alertas_tecnicos SET ${coluna} = NULL WHERE id = ? AND empresa_id = ?`, [alertaId, empresaId]).catch(() => {}); // devolve a reserva
    throw err;
  }
}

/** Rodada automatica (so com avisar_clientes_auto): queda apos N min e volta depois de resolvido. Nunca lanca. */
async function avisarPendentes(empresaId, tec) {
  if (!tec.avisar_clientes_auto) return 0;
  if (await naoPerturbe.emSilencio(empresaId, "alerta_tecnico")) return 0; // adia
  let n = 0;
  const lista = await seguro(async () => {
    const [rows] = await getDb().query(
      `SELECT id, resolvido_em FROM alertas_tecnicos
        WHERE empresa_id = ? AND tipo = 'equipamento_offline' AND equipamento_id IS NOT NULL
          AND ((resolvido_em IS NULL AND clientes_avisados_em IS NULL AND criado_em <= DATE_SUB(NOW(), INTERVAL ? MINUTE))
            OR (resolvido_em IS NOT NULL AND resolvido_em >= DATE_SUB(NOW(), INTERVAL 6 HOUR) AND clientes_avisados_em IS NOT NULL AND clientes_volta_avisados_em IS NULL AND ? = 1))
        ORDER BY id LIMIT 20`,
      [empresaId, tec.apos_minutos, tec.avisar_volta ? 1 : 0]
    );
    return rows;
  });
  for (const a of lista || []) {
    try {
      const r = await avisarClientes(empresaId, a.id, a.resolvido_em ? "volta" : "queda", tec);
      if (r.ok && r.envio_id) n++;
    } catch (err) { console.error(`[alertas-tecnicos] aviso do alerta ${a.id}:`, err.message); }
  }
  return n;
}

module.exports = { abrir, resolver, avisarClientes, avisarPendentes, mensagemDoAlerta, config: at };
