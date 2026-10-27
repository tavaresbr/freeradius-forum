const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const exigeDonoPlataforma = require("../middleware/exigeDonoPlataforma");
const c = require("../controllers/plataformaController");

router.get("/eu", auth, c.eu);
router.get("/donos", auth, exigeDonoPlataforma, c.listarDonos);
router.put("/donos/:id", auth, exigeDonoPlataforma, c.definirDono);

module.exports = router;
