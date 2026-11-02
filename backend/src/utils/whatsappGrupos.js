// Grupos do WhatsApp (puro): normaliza o que a Evolution devolve (formatos variam entre versoes) e monta a previa.
const { normalizarTelefone } = require("../services/whatsappNotify");

const MAX_MEMBROS = 1000;

/** Grupo da Evolution -> { jid, nome, tamanho } (null se nao for grupo). */
function normalizarGrupo(g) {
  const jid = String(g?.id || g?.jid || "");
  if (!jid.endsWith("@g.us")) return null;
  const nome = String(g?.subject || g?.name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "Grupo sem nome";
  const tam = Number(g?.size ?? (Array.isArray(g?.participants) ? g.participants.length : 0));
  return { jid, nome, tamanho: Number.isFinite(tam) ? tam : 0 };
}

/** Participante -> { telefone (com DDI 55) | null, admin, lid }. `@lid` sem numero visivel fica sem telefone. */
function normalizarParticipante(p) {
  const candidatos = [p?.phoneNumber, p?.jid, p?.id].map((v) => String(v || ""));
  let telefone = null;
  for (const c of candidatos) {
    if (c.endsWith("@lid")) continue;
    const dig = c.split("@")[0].replace(/\D/g, "");
    if (!dig) continue;
    telefone = normalizarTelefone(dig);
    if (telefone) break;
  }
  return { telefone, admin: !!p?.admin, lid: !telefone && candidatos.some((c) => c.endsWith("@lid")) };
}

/** Nome da etiqueta do grupo (<= 40 caracteres, limite de whatsapp_etiquetas). */
function nomeEtiqueta(nomeGrupo) {
  const base = "Grupo: " + String(nomeGrupo || "").trim();
  return base.length <= 40 ? base : base.slice(0, 39) + "…";
}

/** Telefones unicos (pelos 10 ultimos digitos) + contagem dos que nao tem numero utilizavel. */
function separarMembros(participantes) {
  const vistos = new Map();
  let semNumero = 0;
  for (const p of participantes || []) {
    const n = normalizarParticipante(p);
    if (!n.telefone) { semNumero++; continue; }
    const f10 = n.telefone.slice(-10);
    if (!vistos.has(f10)) vistos.set(f10, n.telefone);
  }
  return { telefones: [...vistos.values()], semNumero };
}

module.exports = { MAX_MEMBROS, normalizarGrupo, normalizarParticipante, nomeEtiqueta, separarMembros };
