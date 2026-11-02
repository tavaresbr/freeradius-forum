// Varios numeros de WhatsApp por empresa (migration 075): o numero PRINCIPAL continua em /api/whatsapp/instance/*;
// aqui ficam os adicionais (uma instancia da Evolution por numero, mesmo servidor e chave da empresa).
const axios = require("axios");
const crypto = require("crypto");
const db = require("../../db");
const wpp = require("./whatsappController");
const numeros = require("../utils/whatsappNumeros");
const { obterStatus, tabelaInexistente } = require("../utils/assinatura");

const MSG_SEM_MIGRATION = "Vários números de WhatsApp ainda não estão disponíveis neste servidor. Rode a migration 075 (node migrations/075_whatsapp_numeros.js) e reinicie o backend.";
const headers = (evo) => ({ apikey: evo.apiKey, "Content-Type": "application/json" });

/** "open" | "connecting" | "close" | "inexistente" | "desconhecido" da instancia (nunca lanca). */
async function estadoDaInstancia(evo) {
  if (!evo.apiKey) return "desconhecido";
  try {
    const r = await axios.get(`${evo.apiUrl}/instance/connectionState/${evo.instanceName}`, { headers: headers(evo), timeout: 8000 });
    return r.data?.instance?.state || r.data?.state || "desconhecido";
  } catch (err) {
    return err?.response?.status === 404 ? "inexistente" : "desconhecido";
  }
}

function erro(res, err, msg) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  if (tabelaInexistente(err)) return res.status(503).json({ error: MSG_SEM_MIGRATION });
  console.error(`[whatsapp-numeros] ${msg}:`, err?.response?.data || err.message);
  res.status(500).json({ error: msg });
}

async function numeroDaRota(req, res) {
  const n = await numeros.obter(req.empresa_id, req.params.id);
  if (!n) { res.status(404).json({ error: "Número não encontrado" }); return null; }
  return n;
}

async function limiteDaEmpresa(empresaId) {
  const st = await obterStatus(empresaId);
  return st.max_whatsapp_numeros ?? null;
}

// GET /api/whatsapp/numeros -> principal + adicionais, estado de cada um e o limite do plano
exports.listar = async (req, res) => {
  try {
    const extras = await numeros.listar(req.empresa_id);
    const base = await wpp.getEvolutionConfig(req.empresa_id);
    const [estadoPrincipal, ...estados] = await Promise.all([
      estadoDaInstancia(base),
      ...extras.map((n) => estadoDaInstancia({ ...base, instanceName: n.instance_name })),
    ]);
    const limite = numeros.limiteTotal(await limiteDaEmpresa(req.empresa_id));
    res.json({
      numeros: [
        { id: 0, nome: "Número principal", instance_name: base.instanceName, principal: true, estado: estadoPrincipal },
        ...extras.map((n, i) => ({ id: n.id, nome: n.nome, instance_name: n.instance_name, principal: false, estado: estados[i], criado_em: n.criado_em })),
      ],
      limite,
      usados: 1 + extras.length,
      pode_adicionar: limite == null || 1 + extras.length < limite,
    });
  } catch (err) { erro(res, err, "Erro ao listar os números"); }
};

// POST /api/whatsapp/numeros { nome }
exports.criar = async (req, res) => {
  let linhaId = null;
  try {
    const nome = numeros.nomeValido(req.body?.nome);
    if (!nome) return res.status(400).json({ error: `Informe um nome para o número (até ${numeros.NOME_MAX} caracteres).` });
    const base = await wpp.getEvolutionConfig(req.empresa_id);
    if (!base.apiKey) return res.status(400).json({ error: "WhatsApp sem chave de API configurada. Peça ao administrador da plataforma." });
    const limite = await limiteDaEmpresa(req.empresa_id);
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM whatsapp_numeros WHERE empresa_id = ?", [req.empresa_id]);
    const pode = numeros.podeAdicionar(limite, n);
    if (!pode.ok) return res.status(403).json({ code: "LIMITE_WHATSAPP_NUMEROS", error: `Limite do plano atingido: ${pode.limite} número(s) de WhatsApp. Faça upgrade ou compre um adicional.` });

    // Reserva a linha ANTES de falar com a Evolution e reconfere o limite (duas criacoes ao mesmo tempo nao passam do plano).
    const [ins] = await db.query("INSERT INTO whatsapp_numeros (empresa_id, nome, instance_name) VALUES (?, ?, ?)", [req.empresa_id, nome, `tmp_${crypto.randomUUID()}`]);
    linhaId = ins.insertId;
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM whatsapp_numeros WHERE empresa_id = ?", [req.empresa_id]);
    if (!numeros.podeAdicionar(limite, total - 1).ok) {
      await db.query("DELETE FROM whatsapp_numeros WHERE id = ? AND empresa_id = ?", [linhaId, req.empresa_id]);
      return res.status(403).json({ code: "LIMITE_WHATSAPP_NUMEROS", error: "Limite do plano atingido. Faça upgrade ou compre um adicional." });
    }
    const instancia = numeros.nomeInstancia(req.empresa_id, linhaId);
    await db.query("UPDATE whatsapp_numeros SET instance_name = ? WHERE id = ? AND empresa_id = ?", [instancia, linhaId, req.empresa_id]);

    try {
      await axios.post(`${base.apiUrl}/instance/create`, { instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true }, { headers: headers(base), timeout: 30000 });
    } catch (err) {
      const msg = JSON.stringify(err?.response?.data || "").toLowerCase();
      if (!(err?.response?.status === 403 && msg.includes("already"))) throw err; // "ja existe": segue
    }
    try { await require("../services/whatsappAtendimento").ativarWebhook(req.empresa_id, linhaId); }
    catch (e) { console.warn("[whatsapp-numeros] webhook nao ativado:", e?.response?.data || e.message); }
    res.status(201).json({ success: true, numero: { id: linhaId, nome, instance_name: instancia } });
  } catch (err) {
    if (linhaId) await db.query("DELETE FROM whatsapp_numeros WHERE id = ? AND empresa_id = ?", [linhaId, req.empresa_id]).catch(() => {});
    erro(res, err, "Não foi possível criar o número. Confira a Evolution API.");
  }
};

// PUT /api/whatsapp/numeros/:id { nome }
exports.renomear = async (req, res) => {
  try {
    const n = await numeroDaRota(req, res); if (!n) return;
    const nome = numeros.nomeValido(req.body?.nome);
    if (!nome) return res.status(400).json({ error: `Informe um nome (até ${numeros.NOME_MAX} caracteres).` });
    await db.query("UPDATE whatsapp_numeros SET nome = ? WHERE id = ? AND empresa_id = ?", [nome, n.id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) { erro(res, err, "Erro ao renomear o número"); }
};

// GET /api/whatsapp/numeros/:id/qrcode
exports.qrcode = async (req, res) => {
  try {
    const n = await numeroDaRota(req, res); if (!n) return;
    const evo = await wpp.getEvolutionConfig(req.empresa_id, n.id);
    const r = await axios.get(`${evo.apiUrl}/instance/connect/${evo.instanceName}`, { headers: headers(evo), timeout: 20000 });
    res.json(r.data);
  } catch (err) { erro(res, err, "Erro ao obter o QR code"); }
};

// POST /api/whatsapp/numeros/:id/logout  (desconecta o WhatsApp deste numero; a instancia continua para reconectar)
exports.desconectar = async (req, res) => {
  try {
    const n = await numeroDaRota(req, res); if (!n) return;
    const evo = await wpp.getEvolutionConfig(req.empresa_id, n.id);
    await axios.delete(`${evo.apiUrl}/instance/logout/${evo.instanceName}`, { headers: headers(evo), timeout: 20000 });
    res.json({ success: true });
  } catch (err) { erro(res, err, "Erro ao desconectar o número"); }
};

// POST /api/whatsapp/numeros/:id/webhook/ativar
exports.ativarWebhook = async (req, res) => {
  try {
    const n = await numeroDaRota(req, res); if (!n) return;
    res.json({ success: true, ...(await require("../services/whatsappAtendimento").ativarWebhook(req.empresa_id, n.id)) });
  } catch (err) {
    console.error("[whatsapp-numeros] webhook:", err?.response?.data || err.message);
    res.status(502).json({ error: "Não foi possível ativar o recebimento deste número." });
  }
};

// DELETE /api/whatsapp/numeros/:id  (apaga a instancia e o cadastro; o historico das conversas fica, sem poder responder)
exports.remover = async (req, res) => {
  try {
    const n = await numeroDaRota(req, res); if (!n) return;
    const evo = await wpp.getEvolutionConfig(req.empresa_id, n.id);
    try {
      await axios.delete(`${evo.apiUrl}/instance/delete/${evo.instanceName}`, { headers: headers(evo), timeout: 20000 });
    } catch (err) {
      if (err?.response?.status !== 404) throw err; // ja nao existe na Evolution: so remove o cadastro
    }
    await db.query("DELETE FROM whatsapp_numeros WHERE id = ? AND empresa_id = ?", [n.id, req.empresa_id]);
    res.json({ success: true });
  } catch (err) { erro(res, err, "Não foi possível remover o número."); }
};

exports.estadoDaInstancia = estadoDaInstancia;
