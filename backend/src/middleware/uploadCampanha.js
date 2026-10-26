const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const db = require("../../db");

const UPLOAD_ROOT = path.join(__dirname, "../../uploads/campanhas");

const ALLOWED_MIMES = {
  "image/jpeg": { tipo: "imagem", ext: ".jpg" },
  "image/png":  { tipo: "imagem", ext: ".png" },
  "image/webp": { tipo: "imagem", ext: ".webp" },
  "video/mp4":  { tipo: "video",  ext: ".mp4" },
  "video/webm": { tipo: "video",  ext: ".webm" },
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const empresaId  = req.empresa_id;
    const campanhaId = req.params.id;
    const dir = path.join(UPLOAD_ROOT, String(empresaId), String(campanhaId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const meta = ALLOWED_MIMES[file.mimetype];
    const ext  = meta ? meta.ext : path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED_MIMES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error("Tipo de arquivo não permitido. Use JPEG, PNG, WebP, MP4 ou WebM."));
  }
}

const uploadCampanha = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_VIDEO_BYTES }, // 50 MB global; controller enforces per-type
});

// Valida a campanha (da empresa) ANTES de o multer gravar qualquer coisa: sem isso um id invalido ou de outra
// empresa criava a pasta e deixava o arquivo orfao quando o controller respondia 404.
async function validarCampanhaDoUpload(req, res, next) {
  try {
    const [rows] = await db.execute(
      "SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?",
      [req.params.id, req.empresa_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Campanha não encontrada" });
    next();
  } catch (err) {
    console.error("Erro ao validar campanha do upload:", err);
    res.status(500).json({ error: "Erro ao validar campanha" });
  }
}

// multer com erros viram resposta clara (tamanho => 413, tipo invalido => 400) em vez de cair no handler global.
function receberArquivo(req, res, next) {
  uploadCampanha.single("arquivo")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Arquivo excede o limite de 50 MB" });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: "Arquivo inválido" });
    }
    return res.status(400).json({ error: err.message || "Arquivo inválido" });
  });
}

module.exports = { uploadCampanha, validarCampanhaDoUpload, receberArquivo, ALLOWED_MIMES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, UPLOAD_ROOT };
