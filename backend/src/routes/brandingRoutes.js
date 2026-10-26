const express = require("express");
const fs = require("fs");
const multer = require("multer");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const c = require("../controllers/brandingController");

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

router.get("/", c.obter); // publico: landing/login/registro
router.put("/", auth, authorize("super_admin"), c.atualizar);
router.post("/logo", auth, authorize("super_admin"), uploadLogo, c.enviarLogo);
router.delete("/logo", auth, authorize("super_admin"), c.removerLogo);

module.exports = router;
