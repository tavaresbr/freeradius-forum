const express = require("express");
const c = require("../controllers/avisoOperacionalController");
const promo = require("../controllers/promocaoWhatsappController");
const { promocaoLimiter } = require("../middleware/rateLimiters");

const router = express.Router();
router.get("/", c.listar);
router.post("/previa", c.previa);
router.post("/teste", promocaoLimiter, c.testar);
router.post("/", promocaoLimiter, c.criar);
// Mesma fila e mesmas regras das promocoes (sempre por empresa_id)
router.get("/:id", promo.obter);
router.post("/:id/iniciar", promocaoLimiter, promo.iniciar);
router.post("/:id/pausar", promo.pausar);
router.post("/:id/retomar", promo.retomar);
router.post("/:id/cancelar", promo.cancelar);

module.exports = router;
