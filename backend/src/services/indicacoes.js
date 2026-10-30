// Indicacoes: resolve o codigo de indicacao como DESCONTO do indicado (no servidor, via calcularDesconto),
// liga a indicacao ao pagamento e, na aprovacao (idempotente), gera o cupom unico do indicador.
// Tolerante a migration 066 ausente; todas as consultas escopadas por empresa.
const { calcularDesconto } = require("../utils/cupons");
const ind = require("../utils/indicacoes");
const { temColuna } = require("../utils/schemaCache");
const naoPerturbe = require("../utils/naoPerturbe");

const getDb = () => require("../../db");
const NADA = { ok: false };

async function obterConfig(empresaId) {
  const { lerConfigJson } = require("./whatsappAutomacao"); // lazy: evita dependencia circular
  const cfg = await lerConfigJson(empresaId).catch(() => ({}));
  return ind.mesclarComPadrao(cfg.indicacoes);
}

/** Codigo do cliente (cria se nao tiver). Tenta de novo se o codigo gerado colidir. */
async function obterOuCriarCodigo(empresaId, leadId) {
  const db = getDb();
  const [[ex]] = await db.query("SELECT id, codigo FROM indicacoes_codigos WHERE empresa_id = ? AND lead_id = ?", [empresaId, leadId]);
  if (ex) return ex;
  for (let i = 0; i < 6; i++) {
    const codigo = ind.gerarCodigo();
    try {
      const [r] = await db.query("INSERT INTO indicacoes_codigos (empresa_id, lead_id, codigo) VALUES (?, ?, ?)", [empresaId, leadId, codigo]);
      return { id: r.insertId, codigo };
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
      const [[corrida]] = await db.query("SELECT id, codigo FROM indicacoes_codigos WHERE empresa_id = ? AND lead_id = ?", [empresaId, leadId]);
      if (corrida) return corrida; // outro processo criou o codigo deste cliente
    }
  }
  throw new Error("Não foi possível gerar o código");
}

const SQL_CPF = "REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','')";

/**
 * Tenta tratar `codigo` como codigo de indicacao. { ok:false } (sem motivo) ou
 * { ok:true, indicacao:{codigo_id, indicador_lead_id}, cupom:null, valor_original, desconto, valor_final }.
 */
async function resolverIndicacao({ empresaId, plano, codigo, cpf, mac, clienteId }) {
  try {
    if (!plano || Number(plano.empresa_id) !== Number(empresaId)) return NADA;
    if (!(await temColuna("pagamentos", "indicacao_id"))) return NADA; // migration 066 ainda nao rodou
    const cfg = await obterConfig(empresaId);
    if (!cfg.ativo) return NADA;
    const db = getDb();
    const [[cod]] = await db.query("SELECT id, lead_id FROM indicacoes_codigos WHERE empresa_id = ? AND codigo = ?", [empresaId, codigo]);
    if (!cod) return NADA;
    const [[indicador]] = await db.query("SELECT id, cpf, telefone, mac FROM leads WHERE id = ? AND empresa_id = ?", [cod.lead_id, empresaId]);
    if (!indicador) return NADA;
    const cpfLimpo = ind.digitos(cpf);
    if (cpfLimpo.length !== 11) return NADA; // sem CPF nao ha como garantir "1a compra" e "nao e o indicador"
    let indicadoLead = null;
    if (clienteId) [[indicadoLead]] = await db.query("SELECT telefone, mac FROM leads WHERE id = ? AND empresa_id = ?", [clienteId, empresaId]);
    const [comprou] = await db.query(`SELECT id FROM pagamentos WHERE empresa_id = ? AND status IN ('approved','expirado') AND ${SQL_CPF} = ? LIMIT 1`, [empresaId, cpfLimpo]);
    const [indicadoAntes] = await db.query("SELECT id FROM indicacoes WHERE empresa_id = ? AND indicado_cpf = ? AND status IN ('comprou','recompensada') LIMIT 1", [empresaId, cpfLimpo]);
    const [[mes]] = await db.query(
      "SELECT COUNT(*) AS n FROM indicacoes WHERE empresa_id = ? AND indicador_lead_id = ? AND status IN ('comprou','recompensada') AND criado_em >= DATE_FORMAT(NOW(), '%Y-%m-01')",
      [empresaId, indicador.id]
    );
    const indCpf = ind.digitos(indicador.cpf);
    let indicadorEhCliente = true;
    if (cfg.exigir_compra_do_indicador) {
      const [c] = indCpf.length === 11 ? await db.query(`SELECT id FROM pagamentos WHERE empresa_id = ? AND status IN ('approved','expirado') AND ${SQL_CPF} = ? LIMIT 1`, [empresaId, indCpf]) : [[]];
      indicadorEhCliente = c.length > 0;
    }
    const decisao = ind.decidirIndicacao({
      cfg, indicador, indicado: { cpf: cpfLimpo, telefone: indicadoLead?.telefone, mac: mac || indicadoLead?.mac },
      jaComprou: comprou.length > 0, jaIndicado: indicadoAntes.length > 0, usadasMes: mes.n, indicadorEhCliente,
    });
    if (!decisao.ok) return NADA;
    const { desconto, valor_final } = calcularDesconto(plano.valor, cfg.desconto_indicado);
    if (desconto <= 0) return NADA;
    return { ok: true, cupom: null, indicacao: { codigo_id: cod.id, indicador_lead_id: indicador.id }, valor_original: Number(plano.valor), desconto, valor_final };
  } catch (err) {
    console.warn("[indicacao] resolverIndicacao falhou:", err.message);
    return NADA;
  }
}

/** Grava a indicacao pendente do pagamento (e o valor original). Chamada logo apos o INSERT do pagamento. */
async function vincularPagamento(pagamentoId, rc, cpf) {
  const db = getDb();
  const [[pg]] = await db.query("SELECT empresa_id FROM pagamentos WHERE id = ?", [pagamentoId]);
  if (!pg) return false;
  const [r] = await db.query(
    "INSERT IGNORE INTO indicacoes (empresa_id, codigo_id, indicador_lead_id, indicado_cpf, pagamento_id, status) VALUES (?, ?, ?, ?, ?, 'cadastrada')",
    [pg.empresa_id, rc.indicacao.codigo_id, rc.indicacao.indicador_lead_id, ind.digitos(cpf), pagamentoId]
  );
  const [[i]] = await db.query("SELECT id FROM indicacoes WHERE pagamento_id = ? AND empresa_id = ?", [pagamentoId, pg.empresa_id]);
  void r;
  await db.query("UPDATE pagamentos SET indicacao_id = ?, valor_original = ? WHERE id = ? AND empresa_id = ?", [i.id, rc.valor_original, pagamentoId, pg.empresa_id]);
  return true;
}

function textoDesconto(d) { return d.tipo === "percentual" ? `${d.valor}% de desconto` : `R$ ${(d.valor / 100).toFixed(2).replace(".", ",")} de desconto`; }

async function avisarIndicador(empresaId, lead, cupom, cfg) {
  try {
    const { temRecurso } = require("../utils/assinatura");
    const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
    const { renderTemplate, normalizarTelefone, gravarLog } = require("./whatsappNotify");
    const { linkPlanosDoCliente } = require("../utils/linkPlanos");
    const { comCupom } = require("../utils/renovacao");
    const tel = normalizarTelefone(lead?.telefone);
    if (!tel || !(await temRecurso(empresaId, "whatsapp")) || (await naoPerturbe.estaBloqueado(empresaId, tel))) return false;
    if (!(await instanciaConectada(empresaId))) return false;
    const link = comCupom((await linkPlanosDoCliente(empresaId, {}).catch(() => null)) || "", cupom.codigo);
    const validade = cupom.valido_ate instanceof Date ? cupom.valido_ate.toLocaleDateString("pt-BR") : String(cupom.valido_ate || "");
    const mensagem = renderTemplate(ind.MSG_RECOMPENSA, { codigo: cupom.codigo, desconto: textoDesconto(cfg.recompensa_indicador), validade, link }).trim();
    try { await enviarMensagemEstrita(tel, mensagem, empresaId); await gravarLog({ empresa_id: empresaId, telefone: tel, mensagem, contexto_tipo: "indicacao", status: "ok" }); }
    catch (err) { await gravarLog({ empresa_id: empresaId, telefone: tel, mensagem, contexto_tipo: "indicacao", status: "erro", erro_msg: String(err.message).slice(0, 300) }); }
    return true;
  } catch (err) { console.warn("[indicacao] aviso ao indicador nao enviado:", err.message); return false; }
}

/**
 * Na aprovacao do pagamento (chamada por registrarUsoCupom, que ja roda 1x por pagamento): a indicacao vira "comprou"
 * por reserva atomica (so uma vez), o teto mensal e' reconferido e o indicador ganha um cupom unico. Nunca lanca.
 */
async function aoAprovar(pagamentoId) {
  try {
    const db = getDb();
    const [[pg]] = await db.query("SELECT empresa_id, indicacao_id FROM pagamentos WHERE id = ?", [pagamentoId]);
    if (!pg || !pg.indicacao_id) return false;
    const empresaId = pg.empresa_id;
    const [claim] = await db.query("UPDATE indicacoes SET status = 'comprou' WHERE id = ? AND empresa_id = ? AND status = 'cadastrada'", [pg.indicacao_id, empresaId]);
    if (!claim.affectedRows) return false; // ja processada (webhook repetido)
    const [[i]] = await db.query("SELECT id, indicador_lead_id FROM indicacoes WHERE id = ? AND empresa_id = ?", [pg.indicacao_id, empresaId]);
    const cfg = await obterConfig(empresaId);
    const recusar = (motivo) => db.query("UPDATE indicacoes SET status = 'recusada', motivo = ? WHERE id = ? AND empresa_id = ?", [motivo, i.id, empresaId]);
    if (!cfg.ativo) { await recusar("programa_desligado"); return false; }
    const [[mes]] = await db.query(
      "SELECT COUNT(*) AS n FROM indicacoes WHERE empresa_id = ? AND indicador_lead_id = ? AND status IN ('comprou','recompensada') AND id <> ? AND criado_em >= DATE_FORMAT(NOW(), '%Y-%m-01')",
      [empresaId, i.indicador_lead_id, i.id]
    );
    if (Number(mes.n) >= Number(cfg.limite_por_indicador_mes)) { await recusar("limite_mensal"); return false; }
    let cupomId = null, codigo = null;
    for (let t = 0; t < 6 && !cupomId; t++) {
      codigo = ind.gerarCodigo();
      try {
        const [c] = await db.query(
          "INSERT INTO cupons (empresa_id, codigo, tipo, valor, plano_id, valido_ate, max_usos, ativo) VALUES (?, ?, ?, ?, NULL, DATE_ADD(CURDATE(), INTERVAL ? DAY), 1, 1)",
          [empresaId, codigo, cfg.recompensa_indicador.tipo, cfg.recompensa_indicador.valor, cfg.validade_cupom_dias]
        );
        cupomId = c.insertId;
      } catch (err) { if (err.code !== "ER_DUP_ENTRY") throw err; }
    }
    if (!cupomId) { await recusar("cupom_nao_gerado"); return false; }
    await db.query("UPDATE indicacoes SET status = 'recompensada', cupom_indicador_id = ? WHERE id = ? AND empresa_id = ?", [cupomId, i.id, empresaId]);
    const [[lead]] = await db.query("SELECT telefone FROM leads WHERE id = ? AND empresa_id = ?", [i.indicador_lead_id, empresaId]);
    const [[cupom]] = await db.query("SELECT codigo, valido_ate FROM cupons WHERE id = ? AND empresa_id = ?", [cupomId, empresaId]);
    await avisarIndicador(empresaId, lead, cupom || { codigo }, cfg);
    return true;
  } catch (err) {
    console.warn("[indicacao] aoAprovar falhou:", err.message);
    return false;
  }
}

module.exports = { obterConfig, obterOuCriarCodigo, resolverIndicacao, vincularPagamento, aoAprovar, textoDesconto };
