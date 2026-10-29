// Ganchos de pos-compra ligados a nota de satisfacao do atendimento.
// nota 4-5 -> link de avaliacao (1x por nota); nota 1-2 -> alerta ao gestor. Tudo desligado por padrao
// (config_json.pos_compra). Nunca lanca: falha aqui nao atrapalha o webhook.
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const auto = require("./whatsappAutomacao");
const { renderTemplate, gravarLog } = require("./whatsappNotify");
const pc = require("../utils/posCompra");

const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "cliente";

/** Reserva idempotente de um envio. Devolve true se esta chamada ficou com ele. */
async function reservar(empresaId, etapa, referenciaId) {
  const [r] = await db.query("INSERT IGNORE INTO whatsapp_pos_compra (empresa_id, etapa, referencia_id) VALUES (?, ?, ?)", [empresaId, etapa, referenciaId]);
  return r.affectedRows > 0;
}
const devolver = (empresaId, etapa, referenciaId) =>
  db.query("DELETE FROM whatsapp_pos_compra WHERE empresa_id = ? AND etapa = ? AND referencia_id = ?", [empresaId, etapa, referenciaId]).catch(() => {});

async function aoReceberNota(empresaId, conversaId, mensagemId) {
  try {
    if (!mensagemId) return { feito: false, motivo: "sem_mensagem" };
    const cfg = pc.mesclarComPadrao((await auto.lerConfigJson(empresaId)).pos_compra);
    if (!cfg.ativo) return { feito: false, motivo: "desligado" };
    if (!(await temRecurso(empresaId, "whatsapp"))) return { feito: false, motivo: "sem_recurso" };
    const [[conversa]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]);
    const nota = Number(conversa?.nota_satisfacao);
    if (!conversa || !(nota >= 1 && nota <= 5)) return { feito: false, motivo: "sem_nota" };
    const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);

    if (nota >= 4 && cfg.link_avaliacao) {
      if (!(await reservar(empresaId, "avaliacao", mensagemId))) return { feito: false, motivo: "repetido" };
      const texto = renderTemplate(cfg.msg_avaliacao_alta, { nome: primeiroNome(conversa.nome), link: cfg.link_avaliacao, empresa: emp?.nome || "" }).trim();
      try {
        await require("./whatsappAtendimento").enviarTexto(empresaId, null, conversa, texto, { automatica: true });
        return { feito: true, acao: "avaliacao" };
      } catch (err) {
        await devolver(empresaId, "avaliacao", mensagemId);
        return { feito: false, motivo: "erro_envio" };
      }
    }

    if (nota <= 2 && cfg.alerta_nota_baixa.ativo && cfg.alerta_nota_baixa.telefones.length) {
      if (!(await reservar(empresaId, "alerta", mensagemId))) return { feito: false, motivo: "repetido" };
      const { enviarMensagemEstrita, instanciaConectada } = require("../controllers/whatsappController");
      if (!(await instanciaConectada(empresaId))) { await devolver(empresaId, "alerta", mensagemId); return { feito: false, motivo: "desconectada" }; }
      const texto = `⚠️ Nota ${nota}/5 no atendimento: ${conversa.nome || "cliente"} (${pc.mascararTelefone(conversa.telefone)}). Abra a conversa no painel (menu WhatsApp) e retome o contato.`;
      let enviou = 0;
      for (const tel of cfg.alerta_nota_baixa.telefones) {
        try {
          await enviarMensagemEstrita(tel, texto, empresaId);
          await gravarLog({ empresa_id: empresaId, telefone: tel, mensagem: texto, contexto_tipo: "alerta_nota_baixa", status: "ok" });
          enviou++;
        } catch (err) {
          await gravarLog({ empresa_id: empresaId, telefone: tel, mensagem: texto, contexto_tipo: "alerta_nota_baixa", status: "erro", erro_msg: String(err.message || "Erro").slice(0, 500) });
        }
      }
      if (!enviou) await devolver(empresaId, "alerta", mensagemId);
      return { feito: enviou > 0, acao: "alerta" };
    }
    return { feito: false, motivo: "nada_a_fazer" };
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") console.warn("[pos-compra] gancho da nota falhou:", err.message);
    return { feito: false, motivo: "erro" };
  }
}

module.exports = { aoReceberNota, reservar };
