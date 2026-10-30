const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const exigeAssinatura = require("../middleware/assinatura");
const checkPermissao = require("../middleware/checkPermissao");
const { cartaoHotspotLimiters, cupomFalhasLimiter } = require("../middleware/rateLimiters");
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
router.post("/gerar", cupomFalhasLimiter, gerarPagamento);
router.post("/gerar-cartao", ...cartaoHotspotLimiters, cupomFalhasLimiter, gerarPagamentoCartao);
router.post("/mp-device-session/:tipo", proxyDeviceSession);
router.get("/mp-public-key", obterPublicKey);
router.post("/notificacao", notificacaoWebhook);
router.post("/asaas/webhook/:token", require("../controllers/asaasController").webhook);
router.get("/status", verificarStatusPagamento);
router.post("/pix-trial", liberarPixTrial);

// Rotas protegidas (admin)
router.get("/aprovados", auth, tenant, exigeAssinatura, checkPermissao("pagamentos"), listarPagamentosAprovados);
router.get("/todos", auth, tenant, exigeAssinatura, checkPermissao("pagamentos"), listarTodosPagamentos);
// Libera acesso sem pagamento: exige permissao de CRIAR em pagamentos (POST).
router.post("/liberar/:id", auth, tenant, exigeAssinatura, checkPermissao("pagamentos"), liberarManual);

module.exports = router;
