const db = require("../../db");
const axios = require("axios");
const { mascararObjeto, preservarSegredos } = require("../utils/segredos");

// Campos aceitos por tipo (evita gravar JSON arbitrario) e, no WhatsApp, o que so a plataforma pode definir.
const CAMPOS_POR_TIPO = {
  mercadopago: ["public_key", "access_token", "client_id", "client_secret", "email_pagador", "webhook_secret"],
  efi: ["client_id", "client_secret", "chave_pix", "ambiente", "certificado_nome"],
  whatsapp: ["api_url", "api_key", "instance_name"],
};
const WHATSAPP_SO_PLATAFORMA = ["api_url", "api_key"];

// GET /api/empresa-config/:tipo
exports.obterConfig = async (req, res) => {
  try {
    const { tipo } = req.params;
    const validTypes = ["mercadopago", "efi", "whatsapp"];
    if (!validTypes.includes(tipo)) {
      return res.status(400).json({ message: "Tipo de configuração inválido" });
    }

    const [[config]] = await db.execute(
      "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = ?",
      [req.empresa_id, tipo]
    );

    if (!config) {
      return res.json({});
    }

    const parsed = typeof config.config_json === "string"
      ? JSON.parse(config.config_json)
      : config.config_json;

    res.json(mascararObjeto(parsed));
  } catch (err) {
    console.error("Erro ao obter config:", err);
    res.status(500).json({ message: "Erro ao obter configuração" });
  }
};

// POST /api/empresa-config/:tipo
exports.salvarConfig = async (req, res) => {
  try {
    const { tipo } = req.params;
    const validTypes = ["mercadopago", "efi", "whatsapp"];
    if (!validTypes.includes(tipo)) {
      return res.status(400).json({ message: "Tipo de configuração inválido" });
    }

    const [[atualRow]] = await db.execute(
      "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = ?",
      [req.empresa_id, tipo]
    );
    const atual = atualRow
      ? (typeof atualRow.config_json === "string" ? JSON.parse(atualRow.config_json) : atualRow.config_json) || {}
      : {};

    // So os campos conhecidos, e so texto.
    const recebido = {};
    for (const k of CAMPOS_POR_TIPO[tipo]) {
      if (typeof req.body?.[k] === "string") recebido[k] = req.body[k].trim();
    }
    if (tipo === "whatsapp") {
      if (req.user?.role !== "super_admin") {
        // URL/chave da Evolution e nome de instancia de outra empresa: so a plataforma define.
        for (const k of WHATSAPP_SO_PLATAFORMA) delete recebido[k];
        if (recebido.instance_name && recebido.instance_name !== `empresa_${req.empresa_id}`) delete recebido.instance_name;
      }
    }
    const novo = preservarSegredos({ ...atual, ...recebido }, atual);
    const configJson = JSON.stringify(novo);

    await db.execute(
      `INSERT INTO empresa_configs (empresa_id, config_type, config_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), atualizado_em = CURRENT_TIMESTAMP`,
      [req.empresa_id, tipo, configJson]
    );

    res.json({ success: true, message: "Configuração salva com sucesso" });
  } catch (err) {
    console.error("Erro ao salvar config:", err);
    res.status(500).json({ message: "Erro ao salvar configuração" });
  }
};

// POST /api/empresa-config/mercadopago/testar
exports.testarConexaoMercadoPago = async (req, res) => {
  try {
    const [[config]] = await db.execute(
      "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'mercadopago'",
      [req.empresa_id]
    );

    if (!config) {
      return res.status(400).json({ message: "Configuração do Mercado Pago não encontrada" });
    }

    const parsed = typeof config.config_json === "string"
      ? JSON.parse(config.config_json)
      : config.config_json;

    if (!parsed.access_token) {
      return res.status(400).json({ message: "Access Token não configurado" });
    }

    const response = await axios.get("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${parsed.access_token}` },
    });

    res.json({ success: true, usuario: response.data });
  } catch (err) {
    console.error("Erro ao testar conexão MP:", err.message);
    res.status(500).json({ message: "Falha na comunicação com Mercado Pago" });
  }
};
