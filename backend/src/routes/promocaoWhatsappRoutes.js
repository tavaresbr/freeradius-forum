const express = require("express");
const router = express.Router();
const c = require("../controllers/promocaoWhatsappController");
const { promocaoLimiter } = require("../middleware/rateLimiters");

router.get("/", c.listar);
router.post("/previa", c.previa);
router.post("/teste", promocaoLimiter, c.testar);
router.post("/", promocaoLimiter, c.criar);
router.get("/:id", c.obter);
router.post("/:id/iniciar", promocaoLimiter, c.iniciar);
router.post("/:id/pausar", c.pausar);
router.post("/:id/retomar", c.retomar);
router.post("/:id/cancelar", c.cancelar);

module.exports = router;
