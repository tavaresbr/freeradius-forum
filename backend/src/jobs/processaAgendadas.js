// Mensagens agendadas e lembretes de retorno do atendimento WhatsApp. Roda a cada minuto (cron do server.js).
// mensagem: envia o texto na conversa. lembrete: so dispara se o cliente NAO escreveu depois de o lembrete ser criado;
// vira nota interna e reabre a conversa como nao lida. O estado vive no banco (restart do PM2 nao perde nada).
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const { instanciaConectada } = require("../controllers/whatsappController");
const svc = require("../services/whatsappAtendimento");
const crypto = require("crypto");

const LOTE = 30;
const EXPIRA_HORAS = 24; // mensagem que nao conseguiu sair (WhatsApp desconectado) por tanto tempo vira erro
let emExecucao = false;

async function fechar(id, status, erro = null) {
  await db.query("UPDATE whatsapp_agendadas SET status = ?, erro = ?, processado_em = NOW() WHERE id = ?", [status, erro, id]);
}

async function processarUma(ag, cacheEmpresa) {
  let estado = cacheEmpresa.get(ag.empresa_id);
  if (!estado) {
    estado = { recurso: await temRecurso(ag.empresa_id, "whatsapp"), conectada: null };
    cacheEmpresa.set(ag.empresa_id, estado);
  }
  if (!estado.recurso) return fechar(ag.id, "erro", "Empresa sem o recurso WhatsApp");

  // Reserva a linha (outra rodada/processo nao a pega de novo)
  const [claim] = await db.query("UPDATE whatsapp_agendadas SET status = 'enviada', processado_em = NOW() WHERE id = ? AND status = 'pendente'", [ag.id]);
  if (!claim.affectedRows) return;

  const [[conversa]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [ag.conversa_id, ag.empresa_id]);
  if (!conversa) return fechar(ag.id, "erro", "Conversa não existe mais");

  if (ag.tipo === "lembrete") {
    const [[resp]] = await db.query(
      "SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'in' AND criado_em > ?",
      [ag.empresa_id, ag.conversa_id, ag.criado_em]
    );
    if (Number(resp.n) > 0) return fechar(ag.id, "cancelada"); // o cliente ja respondeu: nada a lembrar
    const nota = `⏰ Lembrete: o cliente não respondeu.${ag.texto ? `\n${ag.texto}` : ""}`;
    await db.query(
      `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status, admin_id)
       VALUES (?, ?, ?, 'nota', 'texto', ?, 'enviada', ?)`,
      [ag.empresa_id, ag.conversa_id, `nota_${crypto.randomUUID()}`, nota, ag.admin_id || null]
    );
    await db.query(
      "UPDATE whatsapp_conversas SET status = 'aberta', nao_lidas = nao_lidas + 1 WHERE id = ? AND empresa_id = ?",
      [ag.conversa_id, ag.empresa_id]
    );
    return;
  }

  if (estado.conectada === null) estado.conectada = await instanciaConectada(ag.empresa_id);
  if (!estado.conectada) {
    // Desconectado: devolve para a fila e tenta na proxima rodada (ate EXPIRA_HORAS)
    const atrasada = Date.now() - new Date(ag.enviar_em).getTime() > EXPIRA_HORAS * 3600 * 1000;
    if (atrasada) return fechar(ag.id, "erro", "WhatsApp desconectado: a mensagem não foi enviada");
    await db.query("UPDATE whatsapp_agendadas SET status = 'pendente', processado_em = NULL WHERE id = ?", [ag.id]);
    return;
  }
  try {
    await svc.enviarTexto(ag.empresa_id, ag.admin_id || null, conversa, ag.texto || "");
  } catch (err) {
    await fechar(ag.id, "erro", String(err.message || "Falha ao enviar").slice(0, 250));
  }
}

async function processaAgendadas() {
  if (emExecucao) return;
  emExecucao = true;
  try {
    const [pend] = await db.query(
      `SELECT id, empresa_id, conversa_id, tipo, texto, enviar_em, criado_em, admin_id FROM whatsapp_agendadas
        WHERE status = 'pendente' AND enviar_em <= NOW() ORDER BY enviar_em LIMIT ${LOTE}`
    );
    const cache = new Map();
    for (const ag of pend) {
      try { await processarUma(ag, cache); }
      catch (err) { console.error(`[agendadas] ${ag.id}:`, err.message); await fechar(ag.id, "erro", String(err.message).slice(0, 250)).catch(() => {}); }
    }
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") throw err; // migration 052 ainda nao rodou: nada a fazer
  } finally {
    emExecucao = false;
  }
}

module.exports = processaAgendadas;
