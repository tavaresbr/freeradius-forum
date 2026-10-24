const express = require("express");
const router = express.Router();
const authorize = require("../middleware/authorize");
const {
  limparRadius,
  limparPagamentos,
  limparLGPD
} = require("../controllers/limpezaController");

// Operacoes destrutivas: somente owner/super_admin (auth+tenant aplicados no mount)
router.use(authorize("super_admin", "owner"));

router.delete("/radius", limparRadius);
router.delete("/pagamentos", limparPagamentos);
router.delete("/lgpd", limparLGPD);

module.exports = router;
