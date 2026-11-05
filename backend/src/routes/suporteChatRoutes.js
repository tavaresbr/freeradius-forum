const express = require("express");
const c = require("../controllers/suporteChatController");
const { atendimentoEnvioLimiter } = require("../middleware/rateLimiters");

const router = express.Router();
router.get("/", c.listar);
router.post("/", atendimentoEnvioLimiter, c.enviar);
module.exports = router;
