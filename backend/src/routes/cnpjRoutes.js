const express = require("express");
const router = express.Router();
const { consultarCnpj, CnpjError } = require("../utils/cnpjClient");

// Publica (usada em /registro e no modal de Empresas). So le dados publicos da Receita; nao grava nada.
router.get("/:cnpj", async (req, res) => {
  try {
    res.json(await consultarCnpj(req.params.cnpj));
  } catch (err) {
    if (err instanceof CnpjError) return res.status(err.status).json({ message: err.message });
    console.error("Erro na consulta de CNPJ:", err.message);
    res.status(500).json({ message: "Erro ao consultar CNPJ" });
  }
});

module.exports = router;
