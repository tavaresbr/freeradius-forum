// Validacoes de campanhas (admin). Funcoes puras: devolvem { ok, valor } ou { ok:false, erro }.
const fs = require("fs");

const MAX_NOME = 150;
const MAX_TITULO = 150;
const MAX_DESCRICAO = 2000;
const MAX_LINK = 500;
const DURACAO_MIN = 1;
const DURACAO_MAX = 60;
const DURACAO_PADRAO = 5;

const vazio = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const temCampo = (body, campo) => body && Object.prototype.hasOwnProperty.call(body, campo);

function texto(v, max, rotulo, { obrigatorio = false } = {}) {
  if (vazio(v)) {
    return obrigatorio ? { ok: false, erro: `O campo ${rotulo} é obrigatório` } : { ok: true, valor: null };
  }
  const s = String(v).trim();
  if (s.length > max) return { ok: false, erro: `O campo ${rotulo} deve ter no máximo ${max} caracteres` };
  return { ok: true, valor: s };
}

const validarNome = (v) => texto(v, MAX_NOME, "nome", { obrigatorio: true });
const validarTitulo = (v) => texto(v, MAX_TITULO, "título");
const validarDescricao = (v) => texto(v, MAX_DESCRICAO, "descrição");

// Link de destino: so http(s) (bloqueia javascript:, data: etc.). Vazio => sem link.
function validarLink(v) {
  if (vazio(v)) return { ok: true, valor: null };
  const s = String(v).trim();
  if (s.length > MAX_LINK) return { ok: false, erro: `O link deve ter no máximo ${MAX_LINK} caracteres` };
  let u;
  try { u = new URL(s); } catch { return { ok: false, erro: "Link inválido. Use um endereço começando com http:// ou https://" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, erro: "Link inválido. Use um endereço começando com http:// ou https://" };
  }
  return { ok: true, valor: s };
}

// Duracao do slide em segundos (inteiro 1..60). Vazio => padrao (so no upload).
function validarDuracao(v, { padrao = null } = {}) {
  if (vazio(v)) return padrao === null ? { ok: false, erro: "Informe a duração em segundos" } : { ok: true, valor: padrao };
  const n = Number(v);
  if (!Number.isInteger(n) || n < DURACAO_MIN || n > DURACAO_MAX) {
    return { ok: false, erro: `A duração deve ser um número inteiro entre ${DURACAO_MIN} e ${DURACAO_MAX} segundos` };
  }
  return { ok: true, valor: n };
}

// Data AAAA-MM-DD real (rejeita 2026-02-31). Vazio => sem data (campanha sem limite naquele lado).
function validarData(v, rotulo) {
  if (vazio(v)) return { ok: true, valor: null };
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    return { ok: false, erro: `${rotulo} inválida. Use o formato AAAA-MM-DD` };
  }
  return { ok: true, valor: s };
}

// Valor vindo do MySQL (Date ou string) -> 'AAAA-MM-DD' ou null.
function dataISO(d) {
  if (!d) return null;
  if (d instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}

// Fim nao pode ser antes do inicio (strings ISO comparam corretamente).
function validarJanela(inicio, fim) {
  if (inicio && fim && fim < inicio) return { ok: false, erro: "A data de término não pode ser anterior à de início" };
  return { ok: true };
}

const FREQUENCIAS = ["sempre", "sessao", "diaria"];
function validarFrequencia(v) {
  if (vazio(v)) return { ok: true, valor: "sempre" };
  const s = String(v).trim();
  if (!FREQUENCIAS.includes(s)) return { ok: false, erro: "Frequência inválida. Use sempre, sessao ou diaria" };
  return { ok: true, valor: s };
}

// Assinatura (magic bytes) do arquivo enviado: o mimetype vem do cliente e nao prova nada.
function assinaturaConfere(buf, mimetype) {
  if (!buf || buf.length < 12) return false;
  const ascii = (a, b) => buf.toString("latin1", a, b);
  switch (mimetype) {
    case "image/jpeg": return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png": return buf[0] === 0x89 && ascii(1, 4) === "PNG" && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
    case "image/gif": return ascii(0, 4) === "GIF8";
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/x-icon":
    case "image/vnd.microsoft.icon": return buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0;
    case "video/mp4": return ascii(4, 8) === "ftyp";
    case "video/webm": return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    default: return false;
  }
}

function arquivoConfere(caminho, mimetype) {
  let fd;
  try {
    fd = fs.openSync(caminho, "r");
    const buf = Buffer.alloc(16);
    const lidos = fs.readSync(fd, buf, 0, 16, 0);
    return assinaturaConfere(buf.subarray(0, lidos), mimetype);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignora */ } }
  }
}

module.exports = {
  temCampo, validarNome, validarTitulo, validarDescricao, validarLink, validarDuracao,
  validarData, dataISO, validarJanela, validarFrequencia, FREQUENCIAS,
  assinaturaConfere, arquivoConfere, DURACAO_PADRAO,
};
