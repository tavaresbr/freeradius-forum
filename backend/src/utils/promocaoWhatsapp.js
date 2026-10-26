// Promocoes por WhatsApp: filtros de destinatarios, montagem da mensagem e validacao.
// Funcoes puras (exceto selecionarDestinatarios, que recebe o db) para ficarem testaveis.
const { renderTemplate, normalizarTelefone } = require("../services/whatsappNotify");

const MAX_NOME = 150;
const MAX_MENSAGEM = 1000;
const MAX_DESTINATARIOS = 5000;
const STATUS_LEAD = ["novo", "contactado", "convertido", "descartado"];
const RODAPE = "\n\nPara não receber mais mensagens, responda SAIR.";

// Aceita so o que a tela envia; qualquer outra chave e' descartada.
function sanitizarFiltros(raw) {
  const f = raw && typeof raw === "object" ? raw : {};
  const lista = (v, max) => (Array.isArray(v) ? v : [])
    .map((x) => String(x).trim().slice(0, max)).filter(Boolean).slice(0, 20);
  const out = {
    origens: lista(f.origens, 30),
    status: lista(f.status, 20).filter((s) => STATUS_LEAD.includes(s)),
    q: f.q ? String(f.q).trim().slice(0, 100) : "",
  };
  if (f.lgpd_aceite === true || f.lgpd_aceite === 1 || f.lgpd_aceite === "1") out.lgpd_aceite = 1;
  else if (f.lgpd_aceite === false || f.lgpd_aceite === 0 || f.lgpd_aceite === "0") out.lgpd_aceite = 0;
  return out;
}

// WHERE dos leads elegiveis. SEMPRE: empresa, com telefone, sem opt-out e fora de "descartado".
function montarFiltroLeads(filtrosBrutos, empresaId) {
  const f = sanitizarFiltros(filtrosBrutos);
  const where = ["empresa_id = ?", "telefone IS NOT NULL", "telefone <> ''", "whatsapp_optout = 0", "status <> 'descartado'"];
  const params = [empresaId];
  if (f.origens.length) { where.push(`origem IN (${f.origens.map(() => "?").join(",")})`); params.push(...f.origens); }
  if (f.status.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); params.push(...f.status); }
  if (f.lgpd_aceite !== undefined) { where.push("lgpd_aceite = ?"); params.push(f.lgpd_aceite); }
  if (f.q) {
    where.push("(nome LIKE ? OR email LIKE ? OR telefone LIKE ?)");
    const s = `%${f.q}%`;
    params.push(s, s, s);
  }
  return { where: where.join(" AND "), params, filtros: f };
}

function primeiroNome(nome) {
  const n = String(nome || "").trim().split(/\s+/)[0];
  return n ? n.slice(0, 40) : "";
}

// Mensagem final: modelo com {{nome}} + rodape de descadastro (sempre).
function montarMensagem(modelo, nome) {
  return renderTemplate(String(modelo || "").trim(), { nome: primeiroNome(nome) || "cliente" }) + RODAPE;
}

function validarEnvio(body) {
  const nome = String(body?.nome || "").trim();
  const mensagem = String(body?.mensagem || "").trim();
  if (!nome) return { ok: false, erro: "Informe o nome da promoção" };
  if (nome.length > MAX_NOME) return { ok: false, erro: `O nome deve ter no máximo ${MAX_NOME} caracteres` };
  if (!mensagem) return { ok: false, erro: "Escreva a mensagem da promoção" };
  if (mensagem.length > MAX_MENSAGEM) return { ok: false, erro: `A mensagem deve ter no máximo ${MAX_MENSAGEM} caracteres` };
  return { ok: true, nome, mensagem };
}

// Mascara para mostrar na previa: 55 11 9****-1234
const mascararTelefone = (t) => {
  const d = String(t || "");
  return d.length > 6 ? `${d.slice(0, 4)}*****${d.slice(-4)}` : "****";
};

// Busca os leads elegiveis, normaliza o telefone e tira repetidos (mesmo numero em 2 cadastros = 1 envio).
async function selecionarDestinatarios(db, filtrosBrutos, empresaId) {
  const { where, params, filtros } = montarFiltroLeads(filtrosBrutos, empresaId);
  const [rows] = await db.execute(
    `SELECT id, nome, telefone FROM leads WHERE ${where} ORDER BY id ASC LIMIT ${MAX_DESTINATARIOS * 2}`,
    params
  );
  const vistos = new Set();
  const destinatarios = [];
  let invalidos = 0;
  let duplicados = 0;
  for (const r of rows) {
    const tel = normalizarTelefone(r.telefone);
    if (!tel) { invalidos++; continue; }
    if (vistos.has(tel)) { duplicados++; continue; }
    vistos.add(tel);
    if (destinatarios.length < MAX_DESTINATARIOS) destinatarios.push({ lead_id: r.id, nome: r.nome || null, telefone: tel });
  }
  return { destinatarios, invalidos, duplicados, filtros, limite: MAX_DESTINATARIOS, excedeu: vistos.size > MAX_DESTINATARIOS };
}

module.exports = {
  sanitizarFiltros, montarFiltroLeads, montarMensagem, validarEnvio, mascararTelefone,
  selecionarDestinatarios, primeiroNome, RODAPE, MAX_MENSAGEM, MAX_DESTINATARIOS,
};
