const express = require("express");
const multer = require("multer");
const path = require("path");
const { promocaoLimiter } = require("../middleware/rateLimiters");
const ctrl = require("../controllers/importacaoController");

const router = express.Router();

// Planilha so em memoria (nada vai pro disco) e com limite de tamanho
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if ([".csv", ".txt", ".xlsx"].includes(ext)) cb(null, true);
    else cb(new Error("Formato inválido (use CSV ou XLSX)"));
  },
});

const comArquivo = (req, res, next) =>
  upload.single("arquivo")(req, res, (err) => (err ? res.status(400).json({ message: err.message }) : next()));

router.get("/campos", ctrl.campos);
router.get("/modelo.csv", ctrl.modelo);
router.post("/planilha/preview", comArquivo, ctrl.previewPlanilha);
router.post("/planilha/importar", comArquivo, ctrl.importarPlanilha);
router.post("/whatsapp/importar", promocaoLimiter, ctrl.importarWhatsapp);

module.exports = router;
