const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const exigeAssinatura = require("../middleware/assinatura");
const {
  gerarPagamento,
  gerarPagamentoCartao,
  obterPublicKey,
  notificacaoWebhook,
  listarPagamentosAprovados,
  liberarManual,
  listarTodosPagamentos,
  verificarStatusPagamento,
  proxyDeviceSession,
  liberarPixTrial
} = require("../controllers/pagamentoController");

// Rotas públicas (captive portal)
router.post("/gerar", gerarPagamento);
router.post("/gerar-cartao", gerarPagamentoCartao);
router.post("/mp-device-session/:tipo", proxyDeviceSession);
router.get("/mp-public-key", obterPublicKey);
router.post("/notificacao", notificacaoWebhook);
router.get("/status", verificarStatusPagamento);
router.post("/pix-trial", liberarPixTrial);

// Rotas protegidas (admin)
router.get("/aprovados", auth, tenant, exigeAssinatura, listarPagamentosAprovados);
router.get("/todos", auth, tenant, exigeAssinatura, listarTodosPagamentos);
router.post("/liberar/:id", auth, tenant, exigeAssinatura, liberarManual);

module.exports = router;
