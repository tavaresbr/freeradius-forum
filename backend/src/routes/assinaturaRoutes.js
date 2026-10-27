const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const authorize = require("../middleware/authorize");
const c = require("../controllers/assinaturaController");
const exigeDonoPlataforma = require("../middleware/exigeDonoPlataforma");

// Publico
router.get("/planos", c.planosPublicos);
router.post("/webhook", c.webhook);

// Empresa (isento do bloqueio por assinatura: e' por aqui que ela renova)
router.get("/status", auth, tenant, c.status);
router.get("/adicionais", auth, tenant, c.adicionaisEmpresa);
router.post("/cobranca", auth, tenant, authorize("owner", "super_admin"), c.criarCobranca);
router.post("/cartao", auth, tenant, authorize("owner", "super_admin"), c.pagarCartao);
router.get("/cobranca/:id", auth, tenant, authorize("owner", "super_admin"), c.consultarCobranca);

// Super admin
// Planos, adicionais, assinatura de cada empresa e Mercado Pago da plataforma: so o dono da plataforma
const sa = [auth, exigeDonoPlataforma];
router.get("/admin/planos", ...sa, c.listarPlanosAdmin);
router.post("/admin/planos", ...sa, c.criarPlano);
router.put("/admin/planos/:id", ...sa, c.atualizarPlano);
router.delete("/admin/planos/:id", ...sa, c.removerPlano);
router.get("/admin/adicionais", ...sa, c.listarAdicionaisAdmin);
router.post("/admin/adicionais", ...sa, c.criarAdicional);
router.put("/admin/adicionais/:id", ...sa, c.atualizarAdicional);
router.delete("/admin/adicionais/:id", ...sa, c.removerAdicional);
router.get("/admin/empresa/:empresaId", ...sa, c.obterAssinaturaEmpresa);
router.put("/admin/empresa/:empresaId", ...sa, c.definirAssinaturaEmpresa);
router.get("/admin/plataforma", ...sa, c.obterPlataformaConfig);
router.put("/admin/plataforma", ...sa, c.salvarPlataformaConfig);

module.exports = router;
