const express = require("express");
const router = express.Router();
const c = require("../controllers/voucherController");
const { promocaoLimiter } = require("../middleware/rateLimiters");

router.get("/", c.listar);
router.get("/export", c.exportarCSV);
router.post("/", promocaoLimiter, c.criarLote);
router.post("/:id/cancelar", c.cancelar);
router.delete("/:id", c.excluir);

module.exports = router;
