const express = require("express");
const fs = require("fs");
const multer = require("multer");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const c = require("../controllers/brandingController");
const { arquivoConfere } = require("../utils/campanhaValidacao");

const router = express.Router();
c.DIRS.forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Extensao derivada do MIME real; SVG enviado por usuario bloqueado (XSS).
const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: c.DIRS[0],
    filename: (req, file, cb) => cb(null, `site-${Date.now()}${MIME_EXT[file.mimetype] || ".bin"}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (MIME_EXT[file.mimetype] ? cb(null, true) : cb(new Error("Apenas imagens JPG, PNG ou WEBP"))),
});

const uploadLogo = (req, res, next) =>
  upload.single("logo")(req, res, (err) => (err ? res.status(400).json({ message: err.message }) : next()));

// Favicon e icone do iPhone: mesmo diretorio da logo, prefixo proprio (so o modulo apaga arquivos com esses prefixos).
function uploadIcone(prefixo, campo, mimes, maxBytes, msgTipo) {
  const mw = multer({
    storage: multer.diskStorage({
      destination: c.DIRS[0],
      filename: (req, file, cb) => cb(null, `${prefixo}-${Date.now()}${mimes[file.mimetype] || ".bin"}`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => (mimes[file.mimetype] ? cb(null, true) : cb(new Error(msgTipo))),
  }).single(campo);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? `Arquivo maior que ${Math.round(maxBytes / 1024)} KB.` : err.message });
    // mimetype vem do cliente: confere a assinatura real do arquivo
    if (req.file && !arquivoConfere(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
      return res.status(400).json({ message: msgTipo });
    }
    next();
  });
}
const uploadFavicon = uploadIcone("favicon", "arquivo",
  { "image/png": ".png", "image/webp": ".webp", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico" },
  512 * 1024, "O favicon deve ser PNG, ICO ou WEBP (até 512 KB).");
const uploadApple = uploadIcone("apple", "arquivo", { "image/png": ".png" },
  1024 * 1024, "O ícone do iPhone deve ser PNG (até 1 MB).");

router.get("/", c.obter); // publico: landing/login/registro
router.put("/", auth, authorize("super_admin"), c.atualizar);
router.post("/logo", auth, authorize("super_admin"), uploadLogo, c.enviarLogo);
router.delete("/logo", auth, authorize("super_admin"), c.removerLogo);
router.post("/favicon", auth, authorize("super_admin"), uploadFavicon, c.enviarFavicon);
router.delete("/favicon", auth, authorize("super_admin"), c.removerFavicon);
router.post("/apple-icon", auth, authorize("super_admin"), uploadApple, c.enviarIconeApple);
router.delete("/apple-icon", auth, authorize("super_admin"), c.removerIconeApple);

module.exports = router;
