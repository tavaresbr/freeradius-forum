// Atendimento WhatsApp: configuracao da resposta automatica e mensagens agendadas / lembretes de retorno.
// Toda query filtra por empresa_id; ids do corpo/URL sao conferidos contra a empresa.
const db = require("../../db");
const auto = require("../services/whatsappAutomacao");
const horario = require("../utils/horarioAtendimento");
const avisoExp = require("../utils/avisoExpiracao");
const { renderTemplate, normalizarTelefone, gravarLog } = require("../services/whatsappNotify");
const { enviarMensagemEstrita } = require("./whatsappController");
const { linkPlanosDoCliente } = require("../utils/linkPlanos");
const { temColuna } = require("../utils/schemaCache");

const MAX_PENDENTES = 20; // por conversa
const MAX_DIAS = 90;
const erro500 = (res, err, msg) => { console.error("[atendimento]", err.message); res.status(500).json({ error: msg }); };

async function conversaDaEmpresa(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Conversa inválida" }); return null; }
  const [[c]] = await db.query("SELECT id FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
  if (!c) { res.status(404).json({ error: "Conversa não encontrada" }); return null; }
  return c;
}

const semTabela = (err) => err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146);
const MSG_MIGRATION = "Recurso indisponível: rode a migration 052 (node migrations/052_whatsapp_automacao.js).";

// GET /api/atendimento/automacao
exports.obterAutomacao = async (req, res) => {
  try {
    res.json({ automacao: await auto.obterAutomacao(req.empresa_id), pronto: await temColuna("whatsapp_conversas", "auto_resposta_em") });
  } catch (err) { erro500(res, err, "Erro ao buscar a automação"); }
};

// PUT /api/atendimento/automacao
exports.salvarAutomacao = async (req, res) => {
  try {
    const cfg = horario.validarAutomacao(req.body);
    if (cfg.ativo && !(await temColuna("whatsapp_conversas", "auto_resposta_em"))) {
      return res.status(503).json({ error: MSG_MIGRATION });
    }
    await auto.salvarAutomacao(req.empresa_id, cfg);
    res.json({ success: true, automacao: cfg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao salvar a automação");
  }
};

// GET /api/atendimento/conversas/:id/agendadas
exports.listarAgendadas = async (req, res) => {
  try {
    const c = await conversaDaEmpresa(req, res);
    if (!c) return;
    const [rows] = await db.query(
      `SELECT g.id, g.tipo, g.texto, g.enviar_em, g.status, g.erro, a.nome AS autor
         FROM whatsapp_agendadas g LEFT JOIN admins a ON a.id = g.admin_id
        WHERE g.empresa_id = ? AND g.conversa_id = ? AND g.status IN ('pendente','erro')
        ORDER BY g.enviar_em LIMIT 50`,
      [req.empresa_id, c.id]
    );
    res.json({ agendadas: rows });
  } catch (err) {
    if (semTabela(err)) return res.json({ agendadas: [], indisponivel: true });
    erro500(res, err, "Erro ao listar agendamentos");
  }
};

// POST /api/atendimento/conversas/:id/agendadas { tipo: 'mensagem'|'lembrete', texto, enviar_em: ISO }
exports.criarAgendada = async (req, res) => {
  try {
    const c = await conversaDaEmpresa(req, res);
    if (!c) return;
    const tipo = req.body?.tipo === "lembrete" ? "lembrete" : "mensagem";
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim().slice(0, 4000) : "";
    if (tipo === "mensagem" && !texto) return res.status(400).json({ error: "Digite a mensagem" });
    const quando = new Date(req.body?.enviar_em);
    if (Number.isNaN(quando.getTime())) return res.status(400).json({ error: "Data/hora inválida" });
    const agora = Date.now();
    if (quando.getTime() < agora + 30 * 1000) return res.status(400).json({ error: "Escolha um horário no futuro" });
    if (quando.getTime() > agora + MAX_DIAS * 86400 * 1000) return res.status(400).json({ error: `Máximo ${MAX_DIAS} dias à frente` });
    const [[cont]] = await db.query(
      "SELECT COUNT(*) AS n FROM whatsapp_agendadas WHERE empresa_id = ? AND conversa_id = ? AND status = 'pendente'",
      [req.empresa_id, c.id]
    );
    if (Number(cont.n) >= MAX_PENDENTES) return res.status(400).json({ error: `Máximo de ${MAX_PENDENTES} agendamentos pendentes por conversa` });
    const [r] = await db.query(
      "INSERT INTO whatsapp_agendadas (empresa_id, conversa_id, tipo, texto, enviar_em, admin_id) VALUES (?, ?, ?, ?, ?, ?)",
      [req.empresa_id, c.id, tipo, texto || null, quando, req.user.id]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    if (semTabela(err)) return res.status(503).json({ error: MSG_MIGRATION });
    erro500(res, err, "Erro ao agendar");
  }
};

// DELETE /api/atendimento/agendadas/:id  (cancela; so pendente/erro da propria empresa)
exports.cancelarAgendada = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Agendamento inválido" });
    const [r] = await db.query(
      "UPDATE whatsapp_agendadas SET status = 'cancelada', processado_em = NOW() WHERE id = ? AND empresa_id = ? AND status IN ('pendente','erro')",
      [id, req.empresa_id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Agendamento não encontrado" });
    res.json({ success: true });
  } catch (err) { erro500(res, err, "Erro ao cancelar"); }
};

// GET /api/atendimento/aviso-expiracao
exports.obterAviso = async (req, res) => {
  try {
    const cfg = await auto.lerConfigJson(req.empresa_id);
    res.json({ aviso: avisoExp.mesclarComPadrao(cfg.aviso_expiracao) });
  } catch (err) { erro500(res, err, "Erro ao buscar o aviso"); }
};

// PUT /api/atendimento/aviso-expiracao { ativo, minutos, template }
exports.salvarAviso = async (req, res) => {
  try {
    const aviso = avisoExp.validarAviso(req.body);
    await auto.salvarChave(req.empresa_id, "aviso_expiracao", aviso);
    res.json({ success: true, aviso });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao salvar o aviso");
  }
};

// POST /api/atendimento/aviso-expiracao/teste { telefone, template?, minutos? }  (manda um exemplo a 1 numero)
exports.testarAviso = async (req, res) => {
  try {
    const telefone = normalizarTelefone(req.body?.telefone);
    if (!telefone) return res.status(400).json({ error: "Telefone inválido. Informe DDD + número." });
    const cfg = avisoExp.mesclarComPadrao((await auto.lerConfigJson(req.empresa_id)).aviso_expiracao);
    const modelo = typeof req.body?.template === "string" && req.body.template.trim() ? req.body.template.trim().slice(0, avisoExp.MAX_TEMPLATE) : cfg.template;
    const minutos = Number.isInteger(Number(req.body?.minutos)) ? Number(req.body.minutos) : cfg.minutos;
    const link = (await linkPlanosDoCliente(req.empresa_id, {}).catch(() => null)) || "";
    const mensagem = renderTemplate(modelo, { nome: "Cliente", minutos: String(minutos), link, plano: "Plano exemplo", empresa: "" }).trim();
    await enviarMensagemEstrita(telefone, `[TESTE] ${mensagem}`, req.empresa_id);
    await gravarLog({ empresa_id: req.empresa_id, telefone, mensagem, contexto_tipo: "aviso_expiracao_teste", status: "ok" });
    res.json({ success: true });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || "Erro ao enviar";
    res.status(502).json({ error: `Não foi possível enviar o teste: ${String(msg).slice(0, 150)}` });
  }
};
