// Automacao do atendimento WhatsApp: boas-vindas / fora do horario e fila de mensagens agendadas.
// Config por empresa em empresa_configs 'whatsapp' -> config_json.automacao (desligada por padrao).
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const { temColuna } = require("../utils/schemaCache");
const { exprTelefoneFim10 } = require("../utils/telefoneBusca");
const horario = require("../utils/horarioAtendimento");

const JANELA_HORAS = 12; // no maximo 1 resposta automatica por conversa a cada 12 h (anti-loop)

async function lerConfigJson(empresaId) {
  const [[row]] = await db.query("SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'", [empresaId]);
  if (!row) return {};
  try { return (typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json) || {}; } catch { return {}; }
}

async function obterAutomacao(empresaId) {
  const cfg = await lerConfigJson(empresaId);
  return horario.mesclarComPadrao(cfg.automacao);
}

async function salvarAutomacao(empresaId, automacao) {
  const atual = await lerConfigJson(empresaId);
  const json = JSON.stringify({ ...atual, automacao });
  const [[existe]] = await db.query("SELECT id FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'", [empresaId]);
  if (existe) await db.query("UPDATE empresa_configs SET config_json = ? WHERE empresa_id = ? AND config_type = 'whatsapp'", [json, empresaId]);
  else await db.query("INSERT INTO empresa_configs (empresa_id, config_type, config_json) VALUES (?, 'whatsapp', ?)", [empresaId, json]);
}

const ehSair = (t) => String(t || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "") === "sair";

/**
 * Resposta automatica a uma mensagem RECEBIDA (chamada pelo webhook, sem bloquear). Nunca responde: grupos/status
 * (ja filtrados antes), mensagens enviadas pela empresa, "SAIR", quem pediu opt-out, conversa em que a equipe ja
 * respondeu na janela, nem mais de 1 vez por conversa a cada 12 h.
 * @returns {Promise<{enviada: boolean, motivo?: string}>}
 */
async function responderAutomatico(empresaId, conversaId, m, agora = new Date()) {
  if (m.fromMe) return { enviada: false, motivo: "fromMe" };
  if (m.tipo === "texto" && ehSair(m.texto)) return { enviada: false, motivo: "sair" };
  if (!(await temColuna("whatsapp_conversas", "auto_resposta_em"))) return { enviada: false, motivo: "sem_migration" };
  const cfg = await obterAutomacao(empresaId);
  if (!cfg.ativo) return { enviada: false, motivo: "desligado" };
  if (!(await temRecurso(empresaId, "whatsapp"))) return { enviada: false, motivo: "sem_recurso" };

  const dentro = horario.dentroDoHorario(cfg, agora);
  const modelo = dentro ? cfg.msg_boas_vindas : cfg.msg_fora_horario;
  if (!modelo) return { enviada: false, motivo: "sem_mensagem" };

  const [[conv]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]);
  if (!conv) return { enviada: false, motivo: "sem_conversa" };
  // Boas-vindas so na 1a mensagem da conversa ou depois de 12 h de silencio do cliente.
  if (dentro) {
    const [[prev]] = await db.query(
      `SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'in'
         AND criado_em < ? AND criado_em >= DATE_SUB(?, INTERVAL ${JANELA_HORAS} HOUR)`,
      [empresaId, conversaId, m.quando || agora, m.quando || agora]
    );
    if (Number(prev.n) > 0) return { enviada: false, motivo: "conversa_em_andamento" };
  }
  // A equipe (ou outra automacao) ja respondeu na janela: nao atropela.
  const [[humano]] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out'
       AND criado_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_HORAS} HOUR)`,
    [empresaId, conversaId]
  );
  if (Number(humano.n) > 0) return { enviada: false, motivo: "ja_respondida" };

  if (conv.telefone) {
    const expr = await exprTelefoneFim10();
    const [opt] = await db.query(
      `SELECT id FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1 AND telefone IS NOT NULL AND ${expr} = ? LIMIT 1`,
      [empresaId, String(conv.telefone).replace(/\D/g, "").slice(-10)]
    ).catch(() => [[]]);
    if (opt.length) return { enviada: false, motivo: "optout" };
  }

  // Reserva a janela de forma atomica (duas mensagens quase juntas geram uma unica resposta)
  const [claim] = await db.query(
    `UPDATE whatsapp_conversas SET auto_resposta_em = NOW()
      WHERE id = ? AND empresa_id = ? AND (auto_resposta_em IS NULL OR auto_resposta_em < DATE_SUB(NOW(), INTERVAL ${JANELA_HORAS} HOUR))`,
    [conversaId, empresaId]
  );
  if (!claim.affectedRows) return { enviada: false, motivo: "janela" };

  const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);
  const texto = horario.renderizar(modelo, { nome: conv.nome, empresa: emp?.nome });
  if (!texto) return { enviada: false, motivo: "sem_mensagem" };
  const svc = require("./whatsappAtendimento"); // lazy: evita dependencia circular
  try {
    await svc.enviarTexto(empresaId, null, conv, texto, { automatica: true });
  } catch (err) {
    await db.query("UPDATE whatsapp_conversas SET auto_resposta_em = NULL WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]).catch(() => {});
    throw err;
  }
  return { enviada: true };
}

module.exports = { JANELA_HORAS, obterAutomacao, salvarAutomacao, responderAutomatico };
