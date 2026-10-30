// Nao perturbe: quem nao recebe mensagem proativa (leads.whatsapp_optout + whatsapp_nao_perturbe) e o
// horario de silencio. Tolerante a migration ausente (tabela inexistente = so olha o opt-out dos leads).
const getDb = () => require("../../db"); // lazy: sempre o db atual (testes trocam o modulo)
const { exprTelefoneFim10 } = require("./telefoneBusca");
const silencio = require("./silencio");

const fim10 = (t) => String(t || "").replace(/\D/g, "").slice(-10);
const semTabela = (err) => err && (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR");

/** Set com os fim10 bloqueados entre os telefones informados (da empresa). Nunca lanca. */
async function bloqueados(empresaId, telefones) {
  const alvos = [...new Set((telefones || []).map(fim10).filter((t) => t.length === 10))];
  const out = new Set();
  if (!alvos.length) return out;
  const marcas = alvos.map(() => "?").join(",");
  const db = getDb();
  try {
    const [r] = await db.query(`SELECT telefone_fim10 FROM whatsapp_nao_perturbe WHERE empresa_id = ? AND telefone_fim10 IN (${marcas})`, [empresaId, ...alvos]);
    for (const x of r) out.add(x.telefone_fim10);
  } catch (err) { if (!semTabela(err)) console.warn("[nao-perturbe] lista:", err.message); }
  try {
    const expr = await exprTelefoneFim10();
    const [r] = await db.query(
      `SELECT DISTINCT ${expr} AS f FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1 AND telefone IS NOT NULL AND ${expr} IN (${marcas})`,
      [empresaId, ...alvos]
    );
    for (const x of r) out.add(x.f);
  } catch (err) { console.warn("[nao-perturbe] leads:", err.message); }
  return out;
}

async function estaBloqueado(empresaId, telefone) {
  const f = fim10(telefone);
  if (f.length < 10) return false;
  const db = getDb();
  try {
    const [r] = await db.query("SELECT id FROM whatsapp_nao_perturbe WHERE empresa_id = ? AND telefone_fim10 = ? LIMIT 1", [empresaId, f]);
    if (r.length) return true;
  } catch (err) { if (!semTabela(err)) console.warn("[nao-perturbe] lista:", err.message); }
  try {
    const expr = await exprTelefoneFim10();
    const [r] = await db.query(`SELECT id FROM leads WHERE empresa_id = ? AND whatsapp_optout = 1 AND telefone IS NOT NULL AND ${expr} = ? LIMIT 1`, [empresaId, f]);
    return r.length > 0;
  } catch (err) { console.warn("[nao-perturbe] leads:", err.message); return false; }
}

/** Registra o telefone na lista (INSERT IGNORE). true se gravou agora. Nunca lanca. */
async function adicionar(empresaId, telefone, { motivo = null, origem = "manual" } = {}) {
  const f = fim10(telefone);
  if (f.length < 10) return false;
  try {
    const [r] = await getDb().query(
      "INSERT IGNORE INTO whatsapp_nao_perturbe (empresa_id, telefone_fim10, telefone, motivo, origem) VALUES (?, ?, ?, ?, ?)",
      [empresaId, f, String(telefone).replace(/\D/g, "").slice(0, 20), motivo ? String(motivo).slice(0, 120) : null, origem]
    );
    return r.affectedRows > 0;
  } catch (err) { if (!semTabela(err)) console.warn("[nao-perturbe] adicionar:", err.message); return false; }
}

/** Config de silencio da empresa (com padroes). */
async function configSilencio(empresaId) {
  const { lerConfigJson } = require("../services/whatsappAutomacao"); // lazy: evita dependencia circular
  const cfg = await lerConfigJson(empresaId).catch(() => ({}));
  return silencio.mesclarComPadrao(cfg.nao_perturbe);
}

/** true se agora a empresa esta no silencio para esse tipo de envio. Nunca lanca. */
async function emSilencio(empresaId, tipo, agora = new Date()) {
  try { return silencio.dentroDoSilencio(await configSilencio(empresaId), tipo, agora); } catch { return false; }
}

module.exports = { fim10, bloqueados, estaBloqueado, adicionar, configSilencio, emSilencio };
