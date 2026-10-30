// Alertas de equipamento offline por WhatsApp (config + estado). Permissao 'mikrotiks' e recurso 'whatsapp' (ver server.js).
const db = require("../../db");
const { erroEvolution } = require("../utils/erroEvolution");
const auto = require("../services/whatsappAutomacao");
const al = require("../utils/alertaEquipamentos");
const { enviarMensagemEstrita } = require("./whatsappController");
const { gravarLog } = require("../services/whatsappNotify");

// GET /api/alertas-equipamentos -> { alerta, equipamentos:[{id,nome,ip,online,falhas,verificado_em,erro}] }
exports.obter = async (req, res) => {
  try {
    const cfg = await auto.lerConfigJson(req.empresa_id);
    let equipamentos = [];
    try {
      const [rows] = await db.query(
        `SELECT m.id, m.nome, m.ip, s.online, s.falhas, s.falha_desde, s.verificado_em, s.erro
           FROM mikrotiks m LEFT JOIN equipamento_status s ON s.mikrotik_id = m.id AND s.empresa_id = m.empresa_id
          WHERE m.empresa_id = ? ORDER BY m.nome`,
        [req.empresa_id]
      );
      equipamentos = rows;
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err; // migration 056 ainda nao rodou: so a config
      const [rows] = await db.query("SELECT id, nome, ip FROM mikrotiks WHERE empresa_id = ? ORDER BY nome", [req.empresa_id]);
      equipamentos = rows;
    }
    res.json({ alerta: al.mesclarComPadrao(cfg.alerta_equipamentos), equipamentos });
  } catch (err) {
    console.error("[alerta-equipamentos]", err.message);
    res.status(500).json({ error: "Erro ao carregar os alertas" });
  }
};

// PUT /api/alertas-equipamentos { ativo, telefones[], falhas, avisar_volta }
exports.salvar = async (req, res) => {
  try {
    const alerta = al.validarAlerta(req.body);
    await auto.salvarChave(req.empresa_id, "alerta_equipamentos", alerta);
    res.json({ success: true, alerta });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[alerta-equipamentos]", err.message);
    res.status(500).json({ error: "Erro ao salvar os alertas" });
  }
};

// POST /api/alertas-equipamentos/teste { telefone }  (manda um aviso de exemplo a 1 numero)
exports.testar = async (req, res) => {
  try {
    const { normalizarTelefone } = require("../services/whatsappNotify");
    const telefone = normalizarTelefone(req.body?.telefone);
    if (!telefone) return res.status(400).json({ error: "Telefone inválido. Informe DDD + número." });
    const mensagem = `[TESTE] ${al.mensagemOffline({ nome: "Equipamento de exemplo", ip: "10.0.0.1" }, new Date())}`;
    await enviarMensagemEstrita(telefone, mensagem, req.empresa_id);
    await gravarLog({ empresa_id: req.empresa_id, telefone, mensagem, contexto_tipo: "alerta_equipamento_teste", status: "ok" });
    res.json({ success: true });
  } catch (err) {
    const msg = erroEvolution(err);
    res.status(502).json({ error: `Não foi possível enviar o teste: ${String(msg).slice(0, 150)}` });
  }
};
