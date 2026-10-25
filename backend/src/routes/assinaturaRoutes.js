const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const tenant = require("../middleware/tenant");
const authorize = require("../middleware/authorize");
const c = require("../controllers/assinaturaController");

// Publico
router.get("/planos", c.planosPublicos);
router.post("/webhook", c.webhook);

// Empresa (isento do bloqueio por assinatura: e' por aqui que ela renova)
router.get("/status", auth, tenant, c.status);
router.post("/cobranca", auth, tenant, authorize("owner", "super_admin"), c.criarCobranca);
router.post("/cartao", auth, tenant, authorize("owner", "super_admin"), c.pagarCartao);
router.get("/cobranca/:id", auth, tenant, authorize("owner", "super_admin"), c.consultarCobranca);

// Super admin
const sa = [auth, authorize("super_admin")];
router.get("/admin/planos", ...sa, c.listarPlanosAdmin);
router.post("/admin/planos", ...sa, c.criarPlano);
router.put("/admin/planos/:id", ...sa, c.atualizarPlano);
router.delete("/admin/planos/:id", ...sa, c.removerPlano);
router.get("/admin/empresa/:empresaId", ...sa, c.obterAssinaturaEmpresa);
router.put("/admin/empresa/:empresaId", ...sa, c.definirAssinaturaEmpresa);
router.get("/admin/plataforma", ...sa, c.obterPlataformaConfig);
router.put("/admin/plataforma", ...sa, c.salvarPlataformaConfig);

module.exports = router;
