// src/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const authorize = require("../middleware/authorize");
// Arquivo nao montado no server.js (legado); protegido por seguranca caso seja montado.
router.use(auth, tenant, authorize("super_admin", "owner"));

const { limparRadius, limparPagamentos, limparLGPD } = require("../controllers/limpezaController");

router.delete("/limpar-radius", limparRadius);
router.delete("/limpar-pagamentos", limparPagamentos);
router.delete("/limpar-lgpd", limparLGPD);

module.exports = router;
