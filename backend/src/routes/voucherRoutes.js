const express = require("express");
const router = express.Router();
const c = require("../controllers/voucherController");
const rel = require("../controllers/voucherRelatorioController");
const { promocaoLimiter } = require("../middleware/rateLimiters");

router.get("/", c.listar);
router.get("/export", c.exportarCSV);
router.get("/relatorio", rel.relatorio);
router.get("/relatorio/export", rel.relatorioCSV);
router.post("/", promocaoLimiter, c.criarLote);
router.post("/impressos", c.marcarImpressos);
router.post("/:id/cancelar", c.cancelar);
router.delete("/:id", c.excluir);

module.exports = router;
