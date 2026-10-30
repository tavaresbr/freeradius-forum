const express = require("express");
const router = express.Router();
const controller = require("../controllers/empresaConfigController");
const asaasController = require("../controllers/asaasController");

// Testar conexão MP (deve vir antes de /:tipo para não conflitar)
router.post("/mercadopago/testar", controller.testarConexaoMercadoPago);

// Asaas (antes de /:tipo)
router.post("/asaas/testar", asaasController.testar);
router.get("/asaas/webhook", asaasController.urlWebhook);
router.post("/asaas/webhook/ativar", asaasController.ativarWebhook);

// CRUD genérico por tipo
router.get("/:tipo", controller.obterConfig);
router.post("/:tipo", controller.salvarConfig);

module.exports = router;
