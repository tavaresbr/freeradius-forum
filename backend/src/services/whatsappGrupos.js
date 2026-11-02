// Grupos do WhatsApp por numero: lista (Evolution), previa e importacao dos membros para `leads` com a origem do grupo.
const axios = require("axios");
const db = require("../../db");
const wpp = require("../controllers/whatsappController");
const { exprTelefoneFim10 } = require("../utils/telefoneBusca");
const { formatarTelefone } = require("../utils/importCadastros");
const g = require("../utils/whatsappGrupos");

const MSG_SEM_MIGRATION = "Grupos ainda não estão disponíveis neste servidor. Rode a migration 076 (node migrations/076_whatsapp_grupos.js) e reinicie o backend.";
const cacheLista = new Map(); // empresa:numero -> { t, itens }
const emAndamento = new Set();

const hdr = (evo) => ({ apikey: evo.apiKey, "Content-Type": "application/json" });
const f10 = (tel) => String(tel).slice(-10);
const falha = (status, msg, code) => Object.assign(new Error(msg), { status, code });

async function evoDoNumero(empresaId, numeroId) {
  const evo = await wpp.getEvolutionConfig(empresaId, numeroId); // numero invalido lanca NUMERO_WHATSAPP_INVALIDO
  if (!evo.apiKey) throw falha(409, "WhatsApp não configurado");
  return evo;
}

function traduzir(err) {
  if (err.status) return err;
  if (err.code === "NUMERO_WHATSAPP_INVALIDO") return err;
  const st = err?.response?.status;
  return falha(502, st === 404 ? "Número não conectado ao WhatsApp" : "Não foi possível consultar os grupos agora. Confira se o número está conectado.");
}

async function listarGrupos(empresaId, numeroId, { forcar = false } = {}) {
  const chave = `${empresaId}:${numeroId}`;
  const c = cacheLista.get(chave);
  if (!forcar && c && Date.now() - c.t < 60000) return c.itens;
  try {
    const evo = await evoDoNumero(empresaId, numeroId);
    const r = await axios.get(`${evo.apiUrl}/group/fetchAllGroups/${evo.instanceName}`, { headers: hdr(evo), params: { getParticipants: "false" }, timeout: 30000 });
    const bruto = Array.isArray(r.data) ? r.data : (r.data?.groups || []);
    const itens = bruto.map(g.normalizarGrupo).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    cacheLista.set(chave, { t: Date.now(), itens });
    return itens;
  } catch (e) { throw traduzir(e); }
}

async function participantes(empresaId, numeroId, jid) {
  if (!/^[0-9A-Za-z._-]+@g\.us$/.test(String(jid))) throw falha(400, "Grupo inválido");
  try {
    const evo = await evoDoNumero(empresaId, numeroId);
    const r = await axios.get(`${evo.apiUrl}/group/participants/${evo.instanceName}`, { headers: hdr(evo), params: { groupJid: jid }, timeout: 30000 });
    return Array.isArray(r.data) ? r.data : (r.data?.participants || []);
  } catch (e) { throw traduzir(e); }
}

async function nomeDoGrupo(empresaId, numeroId, jid) {
  if (!/^[0-9A-Za-z._-]+@g\.us$/.test(String(jid))) throw falha(400, "Grupo inválido");
  const lista = await listarGrupos(empresaId, numeroId);
  const gr = lista.find((x) => x.jid === jid);
  if (!gr) throw falha(404, "Grupo não encontrado neste número");
  return gr.nome;
}

async function leadsPorTelefone(empresaId, telefones) {
  if (!telefones.length) return new Map();
  const expr = await exprTelefoneFim10();
  const [rows] = await db.query(`SELECT id, ${expr} AS f10 FROM leads WHERE empresa_id = ? AND ${expr} IN (?)`, [empresaId, telefones.map(f10)]);
  const m = new Map();
  for (const r of rows) if (!m.has(r.f10)) m.set(r.f10, r.id);
  return m;
}

async function previa(empresaId, numeroId, jid) {
  const nome = await nomeDoGrupo(empresaId, numeroId, jid);
  const { telefones, semNumero } = g.separarMembros(await participantes(empresaId, numeroId, jid));
  const existentes = await leadsPorTelefone(empresaId, telefones);
  const jaCad = telefones.filter((t) => existentes.has(f10(t))).length;
  return { nome, total: telefones.length + semNumero, com_numero: telefones.length, sem_numero: semNumero, ja_cadastrados: jaCad, novos: telefones.length - jaCad, excede_limite: telefones.length > g.MAX_MEMBROS };
}

async function importar(empresaId, numeroId, jid) {
  const chave = `${empresaId}`;
  if (emAndamento.has(chave)) throw falha(409, "Já existe uma importação em andamento");
  emAndamento.add(chave);
  try {
    const nome = await nomeDoGrupo(empresaId, numeroId, jid);
    const { telefones } = g.separarMembros(await participantes(empresaId, numeroId, jid));
    if (telefones.length > g.MAX_MEMBROS) throw falha(400, `Grupo com mais de ${g.MAX_MEMBROS} membros com número: importe um grupo menor`);
    if (!telefones.length) return { criados: 0, ja_existiam: 0, marcados: 0, etiqueta: null };
    try { await db.query("SELECT 1 FROM leads_origem_grupo LIMIT 1"); }
    catch (e) { if (e?.code === "ER_NO_SUCH_TABLE") throw falha(503, MSG_SEM_MIGRATION); throw e; }

    const antes = await leadsPorTelefone(empresaId, telefones);
    const novos = telefones.filter((t) => !antes.has(f10(t)));
    for (let i = 0; i < novos.length; i += 200) {
      const valores = novos.slice(i, i + 200).map((t) => [empresaId, "Contato do grupo", formatarTelefone(t) || t, "whatsapp_grupo", "whatsapp_grupo", "novo", 0]);
      await db.query("INSERT INTO leads (empresa_id, nome, telefone, origem, sistema_origem, status, lgpd_aceite) VALUES ?", [valores]);
    }
    const todos = await leadsPorTelefone(empresaId, telefones);
    const linhas = [...new Set(todos.values())].map((id) => [empresaId, id, numeroId, jid, nome]);
    if (linhas.length) await db.query("INSERT IGNORE INTO leads_origem_grupo (empresa_id, lead_id, numero_id, grupo_jid, grupo_nome) VALUES ?", [linhas]);

    // Etiqueta "Grupo: <nome>" nas conversas que esses contatos ja tem
    const etiquetaNome = g.nomeEtiqueta(nome);
    await db.query("INSERT IGNORE INTO whatsapp_etiquetas (empresa_id, nome, cor) VALUES (?, ?, ?)", [empresaId, etiquetaNome, "#0ea5e9"]);
    const [[et]] = await db.query("SELECT id FROM whatsapp_etiquetas WHERE empresa_id = ? AND nome = ?", [empresaId, etiquetaNome]);
    if (et) {
      await db.query(
        `INSERT IGNORE INTO whatsapp_conversa_etiquetas (conversa_id, etiqueta_id, empresa_id)
         SELECT c.id, ?, c.empresa_id FROM whatsapp_conversas c
          WHERE c.empresa_id = ? AND c.telefone IS NOT NULL AND RIGHT(c.telefone, 10) COLLATE utf8mb4_unicode_ci IN (?)`,
        [et.id, empresaId, telefones.map(f10)]
      );
    }
    return { criados: novos.length, ja_existiam: telefones.length - novos.length, marcados: linhas.length, etiqueta: etiquetaNome };
  } catch (e) { throw traduzir(e); }
  finally { emAndamento.delete(chave); }
}

/** Importados de cada grupo do numero: jid -> { quando, total }. Sem a migration devolve vazio. */
async function importadosPorGrupo(empresaId, numeroId) {
  try {
    const [rows] = await db.query(
      "SELECT grupo_jid, COUNT(*) AS total, MAX(importado_em) AS quando FROM leads_origem_grupo WHERE empresa_id = ? AND numero_id = ? GROUP BY grupo_jid", [empresaId, numeroId]);
    return new Map(rows.map((r) => [r.grupo_jid, { total: Number(r.total), quando: r.quando }]));
  } catch { return new Map(); }
}

async function exportarMembros(empresaId, numeroId, jid) {
  const nome = await nomeDoGrupo(empresaId, numeroId, jid);
  const { telefones } = g.separarMembros(await participantes(empresaId, numeroId, jid));
  return { nome, telefones };
}

module.exports = { listarGrupos, previa, importar, importadosPorGrupo, exportarMembros, MSG_SEM_MIGRATION };
