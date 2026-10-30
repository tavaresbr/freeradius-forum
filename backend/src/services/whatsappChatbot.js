// Chatbot de menu do atendimento WhatsApp (desligado por padrao). Roda em segundo plano a partir de registrarMensagem,
// ANTES da resposta automatica: se o chatbot tratou a mensagem, a resposta automatica nao dispara.
// Nunca responde: mensagens da empresa, grupos, "SAIR", quem pediu opt-out, conversa com atendente ou que a equipe
// ja respondeu nas ultimas 12 h, nem conversa entregue a um humano (12 h). Nunca expoe CPF.
const crypto = require("crypto");
const db = require("../../db");
const naoPerturbe = require("../utils/naoPerturbe");
const { temRecurso } = require("../utils/assinatura");
const { temColuna } = require("../utils/schemaCache");
const { verificarSaldoRadius } = require("../utils/leadUtils");
const { linkPlanosDoCliente } = require("../utils/linkPlanos");
const horario = require("../utils/horarioAtendimento");
const bot = require("../utils/chatbot");
const auto = require("./whatsappAutomacao");

const JANELA_HUMANO_H = 12;   // equipe respondeu / conversa entregue a humano
const REOFERTA_H = 12;        // menu volta a ser oferecido sozinho 1x a cada 12 h
const JANELA_MENU_MIN = 30;   // opcao digitada vale se o menu foi enviado ate 30 min antes
const MENU_EXPLICITO_S = 60;  // "menu" digitado: no maximo 1 por minuto
const RODAPE = "\n\nDigite *menu* para ver as opções.";

const ehSair = (t) => String(t || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "") === "sair";

async function enviar(empresaId, conv, texto) {
  const svc = require("./whatsappAtendimento"); // lazy: evita dependencia circular
  await svc.enviarTexto(empresaId, null, conv, texto, { automatica: true });
}

async function enviarMenu(empresaId, conv, cfg, limiteSegundos) {
  const [claim] = await db.query(
    `UPDATE whatsapp_conversas SET chatbot_estado = 'menu', chatbot_em = NOW()
      WHERE id = ? AND empresa_id = ? AND (chatbot_em IS NULL OR chatbot_em < DATE_SUB(NOW(), INTERVAL ${Number(limiteSegundos)} SECOND))`,
    [conv.id, empresaId]
  );
  if (!claim.affectedRows) return false;
  try {
    await enviar(empresaId, conv, bot.montarMenu(cfg, conv.nome));
  } catch (err) {
    await db.query("UPDATE whatsapp_conversas SET chatbot_estado = NULL, chatbot_em = NULL WHERE id = ? AND empresa_id = ?", [conv.id, empresaId]).catch(() => {});
    throw err;
  }
  return true;
}

async function leadDaConversa(empresaId, conv) {
  if (!conv.lead_id) return null;
  const [[l]] = await db.query("SELECT id, cpf FROM leads WHERE id = ? AND empresa_id = ?", [conv.lead_id, empresaId]);
  return l || null;
}

async function respostaSaldo(empresaId, conv) {
  const lead = await leadDaConversa(empresaId, conv);
  const cpf = String(lead?.cpf || "").replace(/\D/g, "");
  if (!cpf) return "Não encontrei um cadastro ligado a este número. Digite 3 para falar com um atendente.";
  const sd = await verificarSaldoRadius(cpf);
  if (!sd.existe) return "Não encontrei um acesso ativo para o seu cadastro.";
  if (!sd.temSaldo) return "Seu tempo de internet acabou. Digite 2 para ver os planos.";
  const min = Math.max(1, Math.ceil((sd.tempoRestante || 0) / 60));
  return `Você ainda tem cerca de ${min} minuto${min === 1 ? "" : "s"} de internet.`;
}

async function respostaPlanos(empresaId, conv) {
  const lead = await leadDaConversa(empresaId, conv);
  const cpf = String(lead?.cpf || "").replace(/\D/g, "");
  let nasId = null;
  if (cpf) {
    const [[ru]] = await db.query("SELECT nas_id FROM radius_users WHERE empresa_id = ? AND username = ? LIMIT 1", [empresaId, cpf]);
    nasId = ru?.nas_id || null;
  }
  const link = await linkPlanosDoCliente(empresaId, { clienteId: lead?.id, nasId });
  return link ? `Escolha o seu plano por aqui: ${link}` : "No momento não consegui gerar o link dos planos. Digite 3 para falar com um atendente.";
}

async function entregarAoAtendente(empresaId, conv, cfg, agora) {
  let texto = cfg.msg_atendente || "Um atendente vai responder você em breve.";
  try {
    const a = await auto.obterAutomacao(empresaId);
    if (a.ativo && a.usar_horario && a.msg_fora_horario && !horario.dentroDoHorario(a, agora)) {
      texto += `\n\n${horario.renderizar(a.msg_fora_horario, { nome: conv.nome, empresa: "" })}`;
    }
  } catch { /* horario e' opcional */ }
  await db.query("UPDATE whatsapp_conversas SET chatbot_estado = 'humano', chatbot_em = NOW(), status = 'aberta' WHERE id = ? AND empresa_id = ?", [conv.id, empresaId]);
  await db.query(
    `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status) VALUES (?, ?, ?, 'nota', 'texto', ?, 'enviada')`,
    [empresaId, conv.id, `nota_${crypto.randomUUID()}`, "🤖 O cliente pediu para falar com um atendente pelo menu do chatbot."]
  );
  return texto;
}

/**
 * @returns {Promise<{tratada: boolean, motivo?: string}>} tratada = o chatbot assumiu a mensagem (nao dispara a resposta automatica)
 */
async function processar(empresaId, conversaId, m, agora = new Date()) {
  if (m.fromMe || m.tipo !== "texto" || !m.texto) return { tratada: false, motivo: "ignorada" };
  if (ehSair(m.texto)) return { tratada: false, motivo: "sair" };
  if (!(await temColuna("whatsapp_conversas", "chatbot_estado"))) return { tratada: false, motivo: "sem_migration" };
  const cfg = bot.mesclarComPadrao((await auto.lerConfigJson(empresaId)).chatbot);
  if (!cfg.ativo || !cfg.opcoes.length) return { tratada: false, motivo: "desligado" };
  if (!(await temRecurso(empresaId, "whatsapp"))) return { tratada: false, motivo: "sem_recurso" };

  const [[conv]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]);
  if (!conv) return { tratada: false, motivo: "sem_conversa" };
  if (conv.atendente_id) return { tratada: false, motivo: "com_atendente" };

  const emAtendimentoHumano = conv.chatbot_estado === "humano" && conv.chatbot_em && (agora - new Date(conv.chatbot_em)) < JANELA_HUMANO_H * 3600 * 1000;
  if (emAtendimentoHumano) return { tratada: true, motivo: "humano" };

  const temAuto = await temColuna("whatsapp_mensagens", "automatica");
  const [[humano]] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out' ${temAuto ? "AND automatica = 0" : ""}
       AND criado_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_HUMANO_H} HOUR)`,
    [empresaId, conversaId]
  );
  if (Number(humano.n) > 0) return { tratada: false, motivo: "equipe_respondeu" };

  if (conv.telefone && (await naoPerturbe.estaBloqueado(empresaId, conv.telefone))) return { tratada: false, motivo: "optout" };

  const q = bot.interpretar(m.texto, cfg);
  const menuRecente = conv.chatbot_estado === "menu" && conv.chatbot_em && (agora - new Date(conv.chatbot_em)) < JANELA_MENU_MIN * 60 * 1000;

  if (q.tipo === "opcao" && menuRecente) {
    let texto;
    if (q.opcao.tipo === "atendente") texto = await entregarAoAtendente(empresaId, conv, cfg, agora);
    else {
      if (q.opcao.tipo === "saldo") texto = await respostaSaldo(empresaId, conv);
      else if (q.opcao.tipo === "planos") texto = await respostaPlanos(empresaId, conv);
      else texto = q.opcao.texto;
      await db.query("UPDATE whatsapp_conversas SET chatbot_estado = 'menu', chatbot_em = NOW() WHERE id = ? AND empresa_id = ?", [conv.id, empresaId]);
      texto += RODAPE;
    }
    await enviar(empresaId, conv, texto);
    return { tratada: true, motivo: `opcao_${q.opcao.tipo}` };
  }

  // "menu" digitado (no maximo 1/minuto) ou primeiro contato / reoferta (1x a cada 12 h): manda o menu
  const limite = q.tipo === "menu" ? MENU_EXPLICITO_S : REOFERTA_H * 3600;
  if (await enviarMenu(empresaId, conv, cfg, limite)) return { tratada: true, motivo: "menu" };
  return { tratada: false, motivo: "texto_livre" };
}

module.exports = { processar };
