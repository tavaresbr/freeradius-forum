const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const exigeDonoPlataforma = require("../middleware/exigeDonoPlataforma");
const c = require("../controllers/plataformaController");
const e = require("../controllers/empresaPainelController");

router.get("/eu", auth, c.eu);
router.get("/donos", auth, exigeDonoPlataforma, c.listarDonos);
router.get("/metricas", auth, exigeDonoPlataforma, c.metricas);
router.get("/empresas/:id", auth, exigeDonoPlataforma, e.resumo);
router.post("/empresas/:id/plano", auth, exigeDonoPlataforma, e.alterarPlano);
router.post("/empresas/:id/gratificacao", auth, exigeDonoPlataforma, e.gratificar);
router.post("/empresas/:id/plano-gratis", auth, exigeDonoPlataforma, e.planoGratis);
router.post("/empresas/:id/plano-pago", auth, exigeDonoPlataforma, e.planoPago);
router.post("/empresas/:id/status-assinatura", auth, exigeDonoPlataforma, e.statusAssinatura);
router.post("/empresas/:id/suspender", auth, exigeDonoPlataforma, e.suspender);
router.post("/empresas/:id/reativar", auth, exigeDonoPlataforma, e.reativar);
router.get("/empresas/:id/notas", auth, exigeDonoPlataforma, e.listarNotas);
router.post("/empresas/:id/notas", auth, exigeDonoPlataforma, e.criarNota);
router.delete("/empresas/:id/notas/:notaId", auth, exigeDonoPlataforma, e.removerNota);
router.get("/empresas/:id/historico", auth, exigeDonoPlataforma, e.historico);
router.put("/donos/:id", auth, exigeDonoPlataforma, c.definirDono);

module.exports = router;
