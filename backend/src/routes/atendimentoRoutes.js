const express = require("express");
const c = require("../controllers/atendimentoController");
const { atendimentoEnvioLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/conversas", c.listarConversas);
router.get("/conversas/:id/mensagens", c.listarMensagens);
router.post("/conversas/:id/mensagens", atendimentoEnvioLimiter, c.enviarMensagem);
router.put("/conversas/:id", c.atualizarConversa);
router.post("/conversas/:id/lida", c.marcarLida);
router.get("/nao-lidas", c.naoLidas);

module.exports = router;
