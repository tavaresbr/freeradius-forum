const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const exigeAssinatura = require("../middleware/assinatura");
const checkPermissao = require("../middleware/checkPermissao");
const { lgpdLogin, getAllLgpd, lgpdCadastro, consultaCpf } = require("../controllers/lgpdController");
const { cpfLookupLimiters } = require("../middleware/rateLimiters");

// Rotas públicas (captive portal)
router.post("/login", lgpdLogin);
router.post("/cadastro", lgpdCadastro);
router.post("/consulta-cpf", ...cpfLookupLimiters, consultaCpf);

// Rotas protegidas (admin)
router.get("/", auth, tenant, exigeAssinatura, checkPermissao("leads"), getAllLgpd);

module.exports = router;
