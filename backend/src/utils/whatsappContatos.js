// Importa os contatos do WhatsApp conectado (Evolution API) como leads sem CPF.
const axios = require("axios");
const db = require("../../db");
const { getEvolutionConfig } = require("../controllers/whatsappController");
const { normalizarTelefone } = require("../services/whatsappNotify");

const MAX_CONTATOS = 20000;
const LOTE = 500;

/** Contatos individuais da instancia (ignora grupos, newsletters e ids @lid sem telefone). */
async function buscarContatos(empresaId) {
  const evo = await getEvolutionConfig(empresaId);
  if (!evo.apiKey) throw new Error("WhatsApp sem chave de API configurada");
  const r = await axios.post(
    `${evo.apiUrl}/chat/findContacts/${evo.instanceName}`,
    { where: {} },
    { headers: { apikey: evo.apiKey, "Content-Type": "application/json" }, timeout: 60000 }
  );
  const lista = Array.isArray(r.data) ? r.data : [];
  const vistos = new Set();
  const contatos = [];
  for (const c of lista) {
    const jid = String(c.remoteJid || c.id || "");
    if (!jid.endsWith("@s.whatsapp.net")) continue;
    const telefone = normalizarTelefone(jid.split("@")[0]);
    if (!telefone || vistos.has(telefone)) continue;
    vistos.add(telefone);
    const nome = String(c.pushName || c.name || "").trim().slice(0, 150);
    contatos.push({ telefone, nome: nome || `WhatsApp ${telefone.slice(-4)}` });
    if (contatos.length >= MAX_CONTATOS) break;
  }
  return contatos;
}

// Compara pelos 10 ultimos digitos (com/sem DDI e 9o digito de DDD >30 nao se confundem).
const ultimos10 = (t) => String(t || "").replace(/\D/g, "").slice(-10);

async function importarContatos(empresaId, { dryRun = false } = {}) {
  const contatos = await buscarContatos(empresaId);
  const [existentes] = await db.query(
    "SELECT telefone FROM leads WHERE empresa_id = ? AND telefone IS NOT NULL AND telefone <> ''",
    [empresaId]
  );
  const jaTem = new Set(existentes.map((e) => ultimos10(e.telefone)));
  const novos = contatos.filter((c) => !jaTem.has(ultimos10(c.telefone)));
  const resumo = {
    total: contatos.length, criados: novos.length, ignorados: contatos.length - novos.length,
    amostra: novos.slice(0, 5).map((c) => ({ nome: c.nome, telefone: c.telefone })),
  };
  if (dryRun) return resumo;

  const agora = new Date();
  for (let i = 0; i < novos.length; i += LOTE) {
    const valores = novos.slice(i, i + LOTE).map((c) => [empresaId, c.nome, c.telefone, "whatsapp", agora, "whatsapp", "novo", 0]);
    await db.query(
      "INSERT INTO leads (empresa_id, nome, telefone, sistema_origem, importado_em, origem, status, lgpd_aceite) VALUES ?",
      [valores]
    );
  }
  return resumo;
}

module.exports = { buscarContatos, importarContatos };
