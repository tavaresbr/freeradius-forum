// Indicacoes (cliente indica cliente): config, convite (codigo + link), lista/ranking e revogacao da recompensa.
// O desconto do indicado e a recompensa sao calculados no servidor (services/indicacoes + utils/cupons).
const db = require("../../db");
const auto = require("../services/whatsappAutomacao");
const svc = require("../services/indicacoes");
const ind = require("../utils/indicacoes");
const naoPerturbe = require("../utils/naoPerturbe");
const { renderTemplate, normalizarTelefone, gravarLog } = require("../services/whatsappNotify");
const { instanciaConectada, enviarMensagemEstrita } = require("./whatsappController");
const { linkPlanosDoCliente } = require("../utils/linkPlanos");
const { comCupom } = require("../utils/renovacao");
const { erroEvolution } = require("../utils/erroEvolution");

const POR_PAGINA = 50;
const MSG_MIGRATION = "Recurso indisponível: rode a migration 066 (node migrations/066_indicacoes.js).";
const erro500 = (res, err, msg) => { console.error(`[indicacoes] ${msg}:`, err.message); res.status(500).json({ error: msg }); };
const semTabela = (err) => err && (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR");
const primeiroNome = (n) => (String(n || "").trim().split(/\s+/)[0] || "cliente").slice(0, 40);

// GET /api/atendimento/indicacoes/config
exports.obterConfig = async (req, res) => {
  try { res.json({ config: await svc.obterConfig(req.empresa_id) }); }
  catch (err) { erro500(res, err, "Erro ao buscar a configuração"); }
};

// PUT /api/atendimento/indicacoes/config
exports.salvarConfig = async (req, res) => {
  try {
    const cfg = ind.validarConfig(req.body);
    await auto.salvarChave(req.empresa_id, "indicacoes", cfg);
    res.json({ success: true, config: cfg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao salvar a configuração");
  }
};

// GET /api/atendimento/indicacoes?status=&pagina=  -> lista (CPF mascarado), resumo e ranking
exports.listar = async (req, res) => {
  try {
    const status = ["cadastrada", "comprou", "recompensada", "recusada"].includes(req.query.status) ? req.query.status : null;
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const where = ["i.empresa_id = ?"];
    const params = [req.empresa_id];
    if (status) { where.push("i.status = ?"); params.push(status); }
    const [itens] = await db.query(
      `SELECT i.id, i.status, i.motivo, i.indicado_cpf, i.criado_em, l.nome AS indicador_nome, c.codigo AS cupom_codigo, c.usos AS cupom_usos
         FROM indicacoes i LEFT JOIN leads l ON l.id = i.indicador_lead_id AND l.empresa_id = i.empresa_id
         LEFT JOIN cupons c ON c.id = i.cupom_indicador_id AND c.empresa_id = i.empresa_id
        WHERE ${where.join(" AND ")} ORDER BY i.id DESC LIMIT ${POR_PAGINA + 1} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      params
    );
    const [resumo] = await db.query("SELECT status, COUNT(*) AS n FROM indicacoes WHERE empresa_id = ? GROUP BY status", [req.empresa_id]);
    const [ranking] = await db.query(
      `SELECT l.nome, COUNT(*) AS indicacoes FROM indicacoes i JOIN leads l ON l.id = i.indicador_lead_id AND l.empresa_id = i.empresa_id
        WHERE i.empresa_id = ? AND i.status IN ('comprou','recompensada') GROUP BY i.indicador_lead_id, l.nome ORDER BY indicacoes DESC LIMIT 10`,
      [req.empresa_id]
    );
    res.json({
      pronto: true, pagina, tem_mais: itens.length > POR_PAGINA,
      itens: itens.slice(0, POR_PAGINA).map(({ indicado_cpf, ...x }) => ({ ...x, indicado_cpf: ind.mascararCpf(indicado_cpf) })),
      resumo: Object.fromEntries(resumo.map((r) => [r.status, Number(r.n)])),
      ranking: ranking.map((r) => ({ nome: r.nome, indicacoes: Number(r.indicacoes) })),
    });
  } catch (err) {
    if (semTabela(err)) return res.json({ pronto: false, itens: [], resumo: {}, ranking: [], aviso: MSG_MIGRATION });
    erro500(res, err, "Erro ao listar as indicações");
  }
};

// POST /api/atendimento/indicacoes/convite { lead_id, enviar? } -> codigo + link (+ envia por WhatsApp se pedido)
exports.convite = async (req, res) => {
  try {
    const leadId = Number(req.body?.lead_id);
    if (!Number.isInteger(leadId) || leadId < 1) return res.status(400).json({ error: "Cliente inválido" });
    const cfg = await svc.obterConfig(req.empresa_id);
    if (!cfg.ativo) return res.status(409).json({ error: "O programa de indicações está desligado. Ligue-o na configuração." });
    const [[lead]] = await db.query("SELECT id, nome, telefone FROM leads WHERE id = ? AND empresa_id = ?", [leadId, req.empresa_id]);
    if (!lead) return res.status(404).json({ error: "Cliente não encontrado" });
    const { codigo } = await svc.obterOuCriarCodigo(req.empresa_id, lead.id);
    const link = comCupom((await linkPlanosDoCliente(req.empresa_id, {}).catch(() => null)) || "", codigo);
    const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [req.empresa_id]).catch(() => [[{}]]);
    const mensagem = renderTemplate(cfg.mensagem_convite, { nome: primeiroNome(lead.nome), empresa: emp?.nome || "", codigo, link }).trim();
    if (!req.body?.enviar) return res.json({ codigo, link, mensagem });
    const tel = normalizarTelefone(lead.telefone);
    if (!tel) return res.status(400).json({ error: "O cliente não tem telefone válido" });
    if (await naoPerturbe.estaBloqueado(req.empresa_id, tel)) return res.status(409).json({ error: "Este cliente pediu para não receber mensagens." });
    if (!(await instanciaConectada(req.empresa_id))) return res.status(409).json({ error: "O WhatsApp da empresa não está conectado." });
    try {
      await enviarMensagemEstrita(tel, mensagem, req.empresa_id);
      await gravarLog({ empresa_id: req.empresa_id, telefone: tel, mensagem, contexto_tipo: "indicacao_convite", status: "ok" });
    } catch (err) {
      const msg = erroEvolution(err);
      await gravarLog({ empresa_id: req.empresa_id, telefone: tel, mensagem, contexto_tipo: "indicacao_convite", status: "erro", erro_msg: String(msg).slice(0, 300) });
      return res.status(502).json({ error: `Não foi possível enviar: ${String(msg).slice(0, 150)}` });
    }
    res.json({ success: true, codigo, link, mensagem });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao gerar o convite");
  }
};

// POST /api/atendimento/indicacoes/:id/revogar -> desativa o cupom da recompensa se ainda nao foi usado
exports.revogar = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const [[i]] = await db.query("SELECT id, status, cupom_indicador_id FROM indicacoes WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!i) return res.status(404).json({ error: "Indicação não encontrada" });
    if (i.status !== "recompensada" || !i.cupom_indicador_id) return res.status(409).json({ error: "Só dá para revogar uma recompensa já gerada." });
    const [r] = await db.query("UPDATE cupons SET ativo = 0 WHERE id = ? AND empresa_id = ? AND usos = 0", [i.cupom_indicador_id, req.empresa_id]);
    if (!r.affectedRows) return res.status(409).json({ error: "O cupom da recompensa já foi usado." });
    await db.query("UPDATE indicacoes SET status = 'recusada', motivo = 'revogada' WHERE id = ? AND empresa_id = ? AND status = 'recompensada'", [id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao revogar");
  }
};
