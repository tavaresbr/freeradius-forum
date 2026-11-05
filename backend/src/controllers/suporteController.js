// Balao de suporte: GET /api/suporte (publico, so dados de exibicao) e GET/PUT /api/plataforma/suporte (dono).
// Config em plataforma_configs chave 'suporte'. Sem telefone na config, usa o numero conectado no chat da plataforma.
const axios = require("axios");
const db = require("../../db");
const wpp = require("./whatsappController");
const { MSG_PADRAO, validarConfig, numeroDoJid } = require("../utils/suporte");

const plataformaId = () => parseInt(process.env.SITE_EMPRESA_ID, 10) || 1;
let cacheNumero = { v: null, ate: 0 };

async function lerConfig() {
  try {
    const [[row]] = await db.execute("SELECT config_json FROM plataforma_configs WHERE chave = 'suporte'");
    const c = row ? (typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json) : {};
    const { config } = validarConfig(c || {});
    return config || { ativo: true, telefone: "", mensagem: MSG_PADRAO };
  } catch {
    return { ativo: true, telefone: "", mensagem: MSG_PADRAO };
  }
}

/** Numero do WhatsApp conectado no chat da plataforma (cache 10 min; nunca lanca). */
async function numeroConectado() {
  if (Date.now() < cacheNumero.ate) return cacheNumero.v;
  let v = null;
  try {
    const evo = await wpp.getEvolutionConfig(plataformaId());
    const r = await axios.get(`${evo.apiUrl}/instance/fetchInstances`, { headers: { apikey: evo.apiKey }, timeout: 8000 });
    const inst = (Array.isArray(r.data) ? r.data : []).find((i) => i.name === evo.instanceName);
    v = numeroDoJid(inst?.ownerJid) || numeroDoJid(inst?.number);
  } catch { v = null; }
  cacheNumero = { v, ate: Date.now() + 10 * 60 * 1000 };
  return v;
}

// Publico: so o que o balao precisa mostrar.
exports.publico = async (req, res) => {
  try {
    const c = await lerConfig();
    const whatsapp = c.telefone || (await numeroConectado());
    res.json({ ativo: !!(c.ativo && whatsapp), whatsapp: c.ativo ? whatsapp : null, mensagem: c.mensagem });
  } catch {
    res.json({ ativo: false });
  }
};

exports.obter = async (req, res) => {
  try {
    const config = await lerConfig();
    res.json({ config, numero_conectado: await numeroConectado() });
  } catch { res.status(500).json({ message: "Erro ao carregar a configuração." }); }
};

exports.salvar = async (req, res) => {
  try {
    const { erro, config } = validarConfig(req.body);
    if (erro) return res.status(400).json({ message: erro });
    await db.execute("INSERT INTO plataforma_configs (chave, config_json) VALUES ('suporte', ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)", [JSON.stringify(config)]);
    cacheNumero = { v: null, ate: 0 };
    res.json({ message: "Configuração salva.", config });
  } catch { res.status(500).json({ message: "Erro ao salvar." }); }
};
