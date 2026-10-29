// Pesquisa de satisfacao do atendimento: pede nota de 1 a 5 ao resolver e captura a resposta (24 h).
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const { temColuna } = require("../utils/schemaCache");
const { exprTelefoneFim10 } = require("../utils/telefoneBusca");
const auto = require("./whatsappAutomacao");

const JANELA_HORAS = 24;
const NOTA = /^\s*([1-5])\s*[.!]?\s*$/;

/** Pede a nota (se a empresa ligou, nao pediu ainda nas ultimas 24 h e o cliente nao pediu para sair). Nunca lanca. */
async function pedirNota(empresaId, adminId, conversa) {
  try {
    if (!conversa.telefone) return { enviada: false, motivo: "sem_telefone" };
    if (!(await temColuna("whatsapp_conversas", "satisfacao_pedida_em"))) return { enviada: false, motivo: "sem_migration" };
    const cfg = await auto.obterAutomacao(empresaId);
    if (!cfg.pedir_nota) return { enviada: false, motivo: "desligado" };
    if (!(await temRecurso(empresaId, "whatsapp"))) return { enviada: false, motivo: "sem_recurso" };
    const expr = await exprTelefoneFim10();
    const [opt] = await db.query(
      `SELECT id FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1 AND telefone IS NOT NULL AND ${expr} = ? LIMIT 1`,
      [empresaId, String(conversa.telefone).replace(/\D/g, "").slice(-10)]
    ).catch(() => [[]]);
    if (opt.length) return { enviada: false, motivo: "optout" };
    // Reserva (1 pedido por conversa a cada 24 h; limpa a nota anterior)
    const [claim] = await db.query(
      `UPDATE whatsapp_conversas SET satisfacao_pedida_em = NOW(), nota_satisfacao = NULL, satisfacao_em = NULL
        WHERE id = ? AND empresa_id = ? AND (satisfacao_pedida_em IS NULL OR satisfacao_pedida_em < DATE_SUB(NOW(), INTERVAL ${JANELA_HORAS} HOUR))`,
      [conversa.id, empresaId]
    );
    if (!claim.affectedRows) return { enviada: false, motivo: "janela" };
    const svc = require("./whatsappAtendimento"); // lazy: evita dependencia circular
    try {
      await svc.enviarTexto(empresaId, adminId || null, conversa, cfg.msg_pedir_nota, { automatica: true });
    } catch (err) {
      await db.query("UPDATE whatsapp_conversas SET satisfacao_pedida_em = NULL WHERE id = ? AND empresa_id = ?", [conversa.id, empresaId]).catch(() => {});
      return { enviada: false, motivo: "erro_envio" };
    }
    return { enviada: true };
  } catch (err) {
    console.warn("[atendimento] pedido de nota falhou:", err.message);
    return { enviada: false, motivo: "erro" };
  }
}

/** Mensagem recebida que e' so um numero 1-5 e responde a um pedido recente = a nota. Devolve true se capturou. */
async function capturarNota(empresaId, conversaId, m) {
  if (m.fromMe || m.tipo !== "texto") return false;
  const achou = NOTA.exec(m.texto || "");
  if (!achou) return false; // caminho comum: nenhuma consulta ao banco
  if (!(await temColuna("whatsapp_conversas", "satisfacao_pedida_em"))) return false;
  const [r] = await db.query(
    `UPDATE whatsapp_conversas SET nota_satisfacao = ?, satisfacao_em = NOW()
      WHERE id = ? AND empresa_id = ? AND nota_satisfacao IS NULL
        AND satisfacao_pedida_em IS NOT NULL AND satisfacao_pedida_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_HORAS} HOUR)`,
    [Number(achou[1]), conversaId, empresaId]
  );
  return r.affectedRows > 0;
}

module.exports = { JANELA_HORAS, pedirNota, capturarNota };
