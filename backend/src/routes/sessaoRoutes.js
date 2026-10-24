const express = require("express");
const router = express.Router();
const { desconectarAnterior } = require("../controllers/sessaoController");
const { cpfLookupLimiters } = require("../middleware/rateLimiters");

// Publica (captive portal): exige CPF + data de nascimento e limita tentativas como o consulta-cpf
router.post("/desconectar-anterior", ...cpfLookupLimiters, desconectarAnterior);

module.exports = router;
