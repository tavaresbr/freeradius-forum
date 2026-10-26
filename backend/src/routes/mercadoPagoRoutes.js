const express = require("express");
const router = express.Router();
const { getConfig, saveConfig } = require("../models/ConfigMercadoPago");
const { mascararObjeto, preservarSegredos } = require("../utils/segredos");

router.get("/", async (req, res) => {
  try {
    const config = await getConfig(req.empresa_id);
    res.json(mascararObjeto(config || {}));
  } catch (err) {
    console.error("Erro ao obter config Mercado Pago:", err);
    res.status(500).json({ message: "Erro ao buscar configuração" });
  }
});

router.post("/", async (req, res) => {
  try {
    const atual = (await getConfig(req.empresa_id)) || {};
    const { public_key, access_token, client_id, client_secret, webhook_secret } =
      preservarSegredos(req.body, atual);
    await saveConfig({ public_key, access_token, client_id, client_secret, webhook_secret }, req.empresa_id);
    res.json({ message: "Configuração Mercado Pago salva com sucesso" });
  } catch (err) {
    console.error("Erro ao salvar config Mercado Pago:", err);
    res.status(500).json({ message: "Erro ao salvar configuração" });
  }
});

// GET testar conexão com Mercado Pago
router.get("/testar-conexao", async (req, res) => {
  try {
    const config = await getConfig(req.empresa_id);
    if (!config || !config.access_token) {
      return res.status(400).json({ message: "Access token não configurado para esta empresa" });
    }

    const response = await fetch("https://api.mercadopago.com/users/me", {
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Erro desconhecido");
    }

    const data = await response.json();
    res.json({ usuario: data });
  } catch (error) {
    console.error("Erro ao testar conexão com Mercado Pago:", error.message);
    res.status(500).json({ message: "Erro na comunicação com Mercado Pago." });
  }
});

module.exports = router;
