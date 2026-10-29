// Midia do atendimento WhatsApp: whitelist de tipos, assinatura (magic bytes) e armazenamento em disco.
// O tipo/extensao vem SEMPRE da whitelist (nunca do nome enviado pelo cliente) e SVG/HTML/executaveis nao entram.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assinaturaConfere } = require("./campanhaValidacao");

const MAX_BYTES = 16 * 1024 * 1024;
const RAIZ_MIDIA = path.resolve(__dirname, "../../uploads/whatsapp");

const TIPOS = {
  "image/jpeg": { ext: "jpg", tipo: "imagem" },
  "image/png": { ext: "png", tipo: "imagem" },
  "image/webp": { ext: "webp", tipo: "imagem" },
  "image/gif": { ext: "gif", tipo: "imagem" },
  "video/mp4": { ext: "mp4", tipo: "video" },
  "audio/ogg": { ext: "ogg", tipo: "audio" },
  "audio/mpeg": { ext: "mp3", tipo: "audio" },
  "audio/mp4": { ext: "m4a", tipo: "audio" },
  "audio/aac": { ext: "aac", tipo: "audio" },
  "audio/wav": { ext: "wav", tipo: "audio" },
  "application/pdf": { ext: "pdf", tipo: "documento" },
  "application/msword": { ext: "doc", tipo: "documento" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", tipo: "documento" },
  "application/vnd.ms-excel": { ext: "xls", tipo: "documento" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", tipo: "documento" },
  "application/vnd.ms-powerpoint": { ext: "ppt", tipo: "documento" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", tipo: "documento" },
  "text/plain": { ext: "txt", tipo: "documento" },
  "text/csv": { ext: "csv", tipo: "documento" },
  "application/zip": { ext: "zip", tipo: "documento" },
};

// Apelidos que navegadores/WhatsApp usam para os mesmos formatos.
const APELIDOS = {
  "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4", "audio/opus": "audio/ogg", "application/x-zip-compressed": "application/zip",
  "image/jpg": "image/jpeg", "application/csv": "text/csv",
};

// Tipos que o painel mostra inline (o resto e' baixado). PDF/Office nunca inline.
const INLINE = (mime) => /^(image\/(jpeg|png|webp|gif)|audio\/|video\/mp4)/.test(mime);

/** "Audio/OGG; codecs=opus" -> "audio/ogg" (ou null se nao for um tipo aceito). */
function mimeAceito(bruto) {
  let m = String(bruto || "").split(";")[0].trim().toLowerCase();
  m = APELIDOS[m] || m;
  return TIPOS[m] ? m : null;
}

/** Nome de exibicao: so o basename, sem controle/barras, ate 200 chars. */
function nomeSeguro(nome) {
  const base = String(nome || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return base.slice(0, 200) || null;
}

function assinaturaMidia(buf, mime) {
  if (!buf || !buf.length) return false;
  const ascii = (a, b) => buf.toString("latin1", a, b);
  switch (mime) {
    case "audio/ogg": return ascii(0, 4) === "OggS";
    case "audio/mpeg": return ascii(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case "audio/mp4": return buf.length >= 8 && ascii(4, 8) === "ftyp";
    case "audio/aac": return (buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0) || (buf.length >= 8 && ascii(4, 8) === "ftyp");
    case "audio/wav": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "application/pdf": return ascii(0, 4) === "%PDF";
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    case "text/plain":
    case "text/csv": return !buf.subarray(0, 1024).includes(0); // texto nao tem byte NUL
    default: return assinaturaConfere(buf, mime); // imagens e mp4
  }
}

/**
 * Valida um arquivo recebido (upload do painel ou base64 da Evolution).
 * @returns {{mime, ext, tipo, nome}} ou lanca Error com .status
 */
function validarArquivo(buf, mimeBruto, nomeOriginal) {
  const erro = (status, msg) => Object.assign(new Error(msg), { status });
  if (!Buffer.isBuffer(buf) || !buf.length) throw erro(400, "Arquivo vazio");
  if (buf.length > MAX_BYTES) throw erro(413, "Arquivo muito grande (máximo 16 MB)");
  const mime = mimeAceito(mimeBruto);
  if (!mime) throw erro(400, "Tipo de arquivo não permitido. Use imagem (JPG/PNG/WEBP), vídeo MP4, áudio, PDF, Office, TXT, CSV ou ZIP.");
  if (!assinaturaMidia(buf, mime)) throw erro(400, "O conteúdo do arquivo não corresponde ao tipo informado");
  return { mime, ext: TIPOS[mime].ext, tipo: TIPOS[mime].tipo, nome: nomeSeguro(nomeOriginal) };
}

/** Grava em uploads/whatsapp/<empresa>/<AAAA-MM>/<uuid>.<ext>; devolve o caminho RELATIVO ao RAIZ_MIDIA. */
async function salvarArquivo(empresaId, buf, ext) {
  const agora = new Date();
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  const rel = `${parseInt(empresaId, 10)}/${mes}/${crypto.randomUUID()}.${ext}`;
  const abs = path.join(RAIZ_MIDIA, rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf, { flag: "wx" });
  return rel;
}

/** Caminho absoluto de um relativo gravado, ou null se escapar da pasta de midia. */
function caminhoAbsoluto(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0")) return null;
  const abs = path.resolve(RAIZ_MIDIA, rel);
  return abs.startsWith(RAIZ_MIDIA + path.sep) ? abs : null;
}

module.exports = { MAX_BYTES, RAIZ_MIDIA, TIPOS, INLINE, mimeAceito, nomeSeguro, assinaturaMidia, validarArquivo, salvarArquivo, caminhoAbsoluto };
