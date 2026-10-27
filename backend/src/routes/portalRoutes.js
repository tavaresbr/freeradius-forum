const express = require("express");
const exigeRecurso = require("../middleware/recurso");
const router = express.Router();
const ctrl = require("../controllers/portalController");
const assinaturaImagem = require("../middleware/assinaturaImagem");

const multer = require("multer");
const path = require("path");
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../../../frontend/dist/uploads/logos');
const publicUploadsDir = path.join(__dirname, '../../../frontend/public/uploads/logos');
[uploadsDir, publicUploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Extensao derivada do MIME real (nunca do nome do arquivo, que o cliente
// controla). SVG bloqueado (pode conter <script> -> XSS).
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || '.bin';
    const id = parseInt(req.params.id, 10) || 0;
    cb(null, `portal-${id}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (MIME_EXT[file.mimetype]) cb(null, true);
  else cb(new Error('Apenas imagens JPG, PNG, GIF ou WEBP são permitidas'));
}});

// Middleware to copy file to public as well for dev environment
const copyToPublic = (req, res, next) => {
  if (req.file) {
    const pubPath = path.join(publicUploadsDir, req.file.filename);
    fs.copyFileSync(req.file.path, pubPath);
  }
  next();
};

router.get("/", ctrl.listarPortais);
router.post("/", ctrl.criarPortal);
router.put("/:id", ctrl.atualizarPortal);
router.delete("/:id", ctrl.deletarPortal);
router.get("/:id/preview", ctrl.previewPortal);
router.post("/:id/logo", upload.single('logo'), assinaturaImagem, copyToPublic, ctrl.uploadLogo);
router.put("/:portalId/campanha", ctrl.vincularCampanha);
router.post("/:id/whatsapp-preview", exigeRecurso("whatsapp"), ctrl.whatsappPreview);
router.post("/:id/whatsapp-teste", exigeRecurso("whatsapp"), ctrl.whatsappTeste);

module.exports = router;
