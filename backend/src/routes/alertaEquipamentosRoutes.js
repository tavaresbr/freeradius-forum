const express = require("express");
const c = require("../controllers/alertaEquipamentosController");
const { atendimentoEnvioLimiter } = require("../middleware/rateLimiters");

const router = express.Router();
router.get("/", c.obter);
router.put("/", c.salvar);
router.post("/teste", atendimentoEnvioLimiter, c.testar);

module.exports = router;
