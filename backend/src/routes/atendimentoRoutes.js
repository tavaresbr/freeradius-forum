const express = require("express");
const multer = require("multer");
const c = require("../controllers/atendimentoController");
const { atendimentoEnvioLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Arquivo so em memoria (validado e gravado pelo servico); limite do WhatsApp para midia: 16 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
const comArquivo = (req, res, next) => upload.single("arquivo")(req, res, (err) => {
  if (!err) return next();
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máximo 16 MB)" : "Arquivo inválido" });
});

router.get("/conversas", c.listarConversas);
router.get("/conversas/:id/mensagens", c.listarMensagens);
router.post("/conversas/:id/mensagens", atendimentoEnvioLimiter, c.enviarMensagem);
router.post("/conversas/:id/midia", atendimentoEnvioLimiter, comArquivo, c.enviarMidia);
router.get("/midia/:id", c.servirMidia);
router.put("/conversas/:id", c.atualizarConversa);
router.post("/conversas/:id/lida", c.marcarLida);
router.get("/nao-lidas", c.naoLidas);

module.exports = router;
