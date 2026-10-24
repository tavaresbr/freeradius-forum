const express = require("express");
const ctrl = require("../controllers/integracaoController");

const router = express.Router();

router.get("/", ctrl.listar);
router.get("/sgp", ctrl.obterSgp);
router.put("/sgp", ctrl.salvarSgp);
router.post("/sgp/testar", ctrl.testarSgp);
router.post("/sgp/amostra", ctrl.amostraSgp);
router.post("/sgp/importar", ctrl.importarSgp);

module.exports = router;
