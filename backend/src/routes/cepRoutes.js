const express = require("express");
const router = express.Router();
const { consultarCep, CepError } = require("../utils/cepClient");

// Publica (usada em /registro e nos modais de Empresas). So le dado publico de endereco; nao grava nada.
router.get("/:cep", async (req, res) => {
  try {
    res.json(await consultarCep(req.params.cep));
  } catch (err) {
    if (err instanceof CepError) return res.status(err.status).json({ message: err.message });
    console.error("Erro na consulta de CEP:", err.message);
    res.status(500).json({ message: "Erro ao consultar CEP" });
  }
});

module.exports = router;
