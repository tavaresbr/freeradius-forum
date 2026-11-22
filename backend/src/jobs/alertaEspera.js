// Aviso ao proprietario quando ha cliente esperando no chat do WhatsApp. Roda a cada 2 min (cron do server.js).
// Por empresa com o aviso LIGADO (config_json.alerta_espera, desligado por padrao): acha as conversas abertas em que o cliente
// ficou sem resposta por N minutos e manda UMA mensagem (lista) aos telefones da config. "Esperando" =
//  (a) a ultima mensagem real da conversa e' do cliente e ninguem respondeu depois, ou
//  (b) a conversa foi passada a um humano (chatbot/IA) e a equipe ainda nao respondeu.
// Resposta automatica/IA nao conta como atendimento. 1 aviso por espera (espera_avisada_em, reserva atomica; devolvida se
// o envio falhar). Nunca avisa espera com mais de 24 h (ligar o aviso nao dispara o historico).
const db = require("../../db");
const { erroEvolution } = require("../utils/erroEvolution");
const { temRecurso } = require("../utils/assinatura");
const { temColuna } = require("../utils/schemaCache");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog } = require("../services/whatsappNotify");
const auto = require("../services/whatsappAutomacao");
const horario = require("../utils/horarioAtendimento");
const ae = require("../utils/alertaEspera");

const JANELA_H = 24;
const INTERVALO_MS = [3000, 8000];
let emExecucao = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));

/** Conversas esperando ha pelo menos `minutos`, ainda nao avisadas. @returns {Promise<{id, nome, telefone, desde: Date}[]>} */
async function esperando(empresaId, minutos) {
  const temAuto = await temColuna("whatsapp_mensagens", "automatica");
  const humano = temAuto ? "AND o.automatica = 0" : "";
  const [a] = await db.query(
    `SELECT c.id, c.nome, c.telefone, x.desde
       FROM whatsapp_conversas c
       JOIN (SELECT m.conversa_id, MIN(m.criado_em) AS desde FROM whatsapp_mensagens m
              WHERE m.empresa_id = ? AND m.direcao = 'in' AND m.criado_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_H} HOUR)
                AND m.id > COALESCE((SELECT MAX(o.id) FROM whatsapp_mensagens o WHERE o.conversa_id = m.conversa_id AND o.empresa_id = m.empresa_id AND o.direcao = 'out'), 0)
              GROUP BY m.conversa_id) x ON x.conversa_id = c.id
      WHERE c.empresa_id = ? AND c.status = 'aberta' AND x.desde <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND (c.espera_avisada_em IS NULL OR c.espera_avisada_em < x.desde)
      ORDER BY x.desde LIMIT 100`,
    [empresaId, empresaId, minutos]
  );
  let b = [];
  if (temAuto && (await temColuna("whatsapp_conversas", "chatbot_estado"))) {
    [b] = await db.query(
      `SELECT c.id, c.nome, c.telefone, c.chatbot_em AS desde
         FROM whatsapp_conversas c
        WHERE c.empresa_id = ? AND c.status = 'aberta' AND c.chatbot_estado = 'humano'
          AND c.chatbot_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_H} HOUR) AND c.chatbot_em <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          AND (c.espera_avisada_em IS NULL OR c.espera_avisada_em < c.chatbot_em)
          AND NOT EXISTS (SELECT 1 FROM whatsapp_mensagens o WHERE o.conversa_id = c.id AND o.empresa_id = c.empresa_id AND o.direcao = 'out' ${humano} AND o.criado_em >= c.chatbot_em)
        ORDER BY c.chatbot_em LIMIT 100`,
      [empresaId, minutos]
    );
  }
  const porId = new Map();
  for (const r of [...a, ...b]) {
    const atual = porId.get(r.id);
    if (!atual || new Date(r.desde) < new Date(atual.desde)) porId.set(r.id, r);
  }
  return [...porId.values()].sort((x, y) => new Date(x.desde) - new Date(y.desde));
}

/** Reserva a espera (so 1 aviso por espera, mesmo com 2 execucoes). @returns {Promise<boolean>} */
async function reservar(empresaId, conversa) {
  const [r] = await db.query(
    "UPDATE whatsapp_conversas SET espera_avisada_em = NOW() WHERE id = ? AND empresa_id = ? AND (espera_avisada_em IS NULL OR espera_avisada_em < ?)",
    [conversa.id, empresaId, conversa.desde]
  );
  return r.affectedRows > 0;
}

async function devolver(empresaId, ids) {
  if (!ids.length) return;
  await db.query(`UPDATE whatsapp_conversas SET espera_avisada_em = NULL WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [empresaId, ...ids]).catch(() => {});
}

async function empresasComAviso() {
  const [rows] = await db.query("SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp' AND config_json LIKE '%alerta_espera%'");
  const out = [];
  for (const r of rows) {
    try {
      const cfg = typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json;
      const alerta = ae.mesclarComPadrao(cfg?.alerta_espera);
      if (cfg?.alerta_espera && alerta.ativo && alerta.telefones.length) out.push({ empresaId: r.empresa_id, alerta, automacao: horario.mesclarComPadrao(cfg.automacao) });
    } catch { /* config ilegivel: ignora */ }
  }
  return out;
}

async function linkAtendimento(empresaId) {
  const host = String(process.env.SYSTEM_DOMAIN || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) return "";
  const [[e]] = await db.query("SELECT slug FROM empresas WHERE id = ?", [empresaId]);
  return e?.slug ? `https://${host}/admin/${e.slug}/atendimento/conversas` : "";
}

async function processarEmpresa({ empresaId, alerta, automacao }, { dormirFn, agora }) {
  if (!(await temColuna("whatsapp_conversas", "espera_avisada_em"))) return 0;
  if (!(await temRecurso(empresaId, "whatsapp"))) return 0;
  if (alerta.somente_horario && automacao.usar_horario && !horario.dentroDoHorario(automacao, agora)) return 0;
  if (!(await instanciaConectada(empresaId))) return 0; // nada e' reservado: a proxima rodada tenta de novo

  const lista = await esperando(empresaId, alerta.minutos);
  const reservadas = [];
  for (const c of lista) if (await reservar(empresaId, c)) reservadas.push(c);
  if (!reservadas.length) return 0;

  const itens = reservadas.map((c) => ({ nome: c.nome, telefone: c.telefone, espera_min: Math.max(1, (agora - new Date(c.desde)) / 60000) }));
  const mensagem = ae.montarMensagem(itens, await linkAtendimento(empresaId));
  let enviou = 0;
  for (let i = 0; i < alerta.telefones.length; i++) {
    try {
      await enviarMensagemEstrita(alerta.telefones[i], mensagem, empresaId);
      await gravarLog({ empresa_id: empresaId, telefone: alerta.telefones[i], mensagem, contexto_tipo: "alerta_espera", status: "ok" });
      enviou++;
    } catch (err) {
      await gravarLog({ empresa_id: empresaId, telefone: alerta.telefones[i], mensagem, contexto_tipo: "alerta_espera", status: "erro", erro_msg: String(erroEvolution(err)).slice(0, 500) });
    }
    if (i < alerta.telefones.length - 1) await dormirFn(intervalo());
  }
  if (!enviou) { await devolver(empresaId, reservadas.map((c) => c.id)); return 0; } // ninguem recebeu: tenta de novo na proxima rodada
  return reservadas.length;
}

// opts.dormir / opts.agora permitem aos testes nao esperar
async function alertaEspera(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    let total = 0;
    for (const e of await empresasComAviso()) {
      try { total += await processarEmpresa(e, { dormirFn: opts.dormir || dormir, agora: opts.agora || new Date() }); }
      catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.error(`[alerta-espera] empresa ${e.empresaId}:`, err.message); }
    }
    return { avisadas: total };
  } finally {
    emExecucao = false;
  }
}

module.exports = alertaEspera;
module.exports.esperando = esperando;

if (require.main === module) {
  alertaEspera().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
