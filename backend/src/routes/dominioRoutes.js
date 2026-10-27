const express = require("express");
const router = express.Router();
const c = require("../controllers/dominioController");
const { dominioLimiter } = require("../middleware/rateLimiters");

router.get("/", c.obter);
router.put("/", dominioLimiter, c.salvar);
router.post("/verificar", dominioLimiter, c.verificar);
router.post("/ativar", dominioLimiter, c.ativar);
router.delete("/", dominioLimiter, c.remover);

module.exports = router;
