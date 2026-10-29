"use strict";

const express = require("express");
const fs = require("fs");
const multer = require("multer");
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const exigeAssinatura = require("../middleware/assinatura");
const checkPermissao = require("../middleware/checkPermissao");
const c = require("../controllers/brandingEmpresaController");
const { DIRS } = require("../controllers/brandingController");
const { arquivoConfere } = require("../utils/campanhaValidacao");

// /api/empresas/minha/*: identidade (logo, favicon, icone do iPhone, tamanhos) da PROPRIA empresa.
// A empresa vem so do token (tenant), nunca da URL/corpo. Permissao `configuracoes` (Administrador).
const router = express.Router();
DIRS.forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
router.use(auth, tenant, exigeAssinatura, checkPermissao("configuracoes"));

// Extensao derivada do MIME real; SVG enviado por usuario bloqueado (XSS). Arquivo: empresa-<id>-<tipo>-<ts>.<ext>
function upload(campo, tipoNome, mimes, maxBytes, msgTipo) {
  const mw = multer({
    storage: multer.diskStorage({
      destination: DIRS[0],
      filename: (req, file, cb) => cb(null, `empresa-${parseInt(req.empresa_id, 10) || 0}-${tipoNome}-${Date.now()}${mimes[file.mimetype] || ".bin"}`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => (mimes[file.mimetype] ? cb(null, true) : cb(new Error(msgTipo))),
  }).single(campo);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: err.code === "LIMIT_FILE_SIZE" ? `Arquivo maior que ${Math.round(maxBytes / 1024)} KB.` : err.message });
    // o mimetype vem do cliente: confere a assinatura real do arquivo
    if (req.file && !arquivoConfere(req.file.path, req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
      return res.status(400).json({ message: msgTipo });
    }
    next();
  });
}
const uploadLogo = upload("logo", "logo", { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }, 2 * 1024 * 1024, "Apenas imagens JPG, PNG ou WEBP (até 2 MB).");
const uploadFavicon = upload("arquivo", "fav", { "image/png": ".png", "image/webp": ".webp", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico" }, 512 * 1024, "O favicon deve ser PNG, ICO ou WEBP (até 512 KB).");
const uploadApple = upload("arquivo", "apple", { "image/png": ".png" }, 1024 * 1024, "O ícone do iPhone deve ser PNG (até 1 MB).");

router.get("/branding", c.obter);
router.put("/branding", c.atualizarTamanhos);
router.post("/logo", uploadLogo, c.logo.enviar);
router.delete("/logo", c.logo.remover);
router.post("/favicon", uploadFavicon, c.favicon.enviar);
router.delete("/favicon", c.favicon.remover);
router.post("/apple-icon", uploadApple, c.apple.enviar);
router.delete("/apple-icon", c.apple.remover);

module.exports = router;
