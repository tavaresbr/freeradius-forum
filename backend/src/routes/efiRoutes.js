const express = require("express");
const multer = require("multer");
const path = require("path");
const { getConfig, saveConfig } = require("../models/EfiConfig");
const { mascararObjeto, preservarSegredos } = require("../utils/segredos");
const router = express.Router();

// Certificado EFI: aceita apenas extensoes de certificado e limita o tamanho
// (certificados sao pequenos; evita upload abusivo de arquivos grandes).
const CERT_EXT = ['.pem', '.crt', '.cer', '.p12', '.pfx', '.key'];
const upload = multer({
  dest: "certificados/",
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (CERT_EXT.includes(ext)) cb(null, true);
    else cb(new Error('Arquivo de certificado inválido (use .pem)'));
  },
});

router.get("/", async (req, res) => {
  const config = await getConfig(req.empresa_id);
  res.json(mascararObjeto(config || {}));
});

router.post("/", upload.single("certificado"), async (req, res) => {
  try {
    const atual = (await getConfig(req.empresa_id)) || {};
    const { client_id, client_secret, chave_pix, ambiente } = preservarSegredos(req.body, atual);
    const certificado_nome = req.file?.filename || atual.certificado_nome;
    await saveConfig({ client_id, client_secret, chave_pix, ambiente, certificado_nome }, req.empresa_id);
    res.json({ message: "Configuração salva com sucesso." });
  } catch (err) {
    console.error("Erro ao salvar config da Efí:", err);
    res.status(500).json({ message: "Erro ao salvar configuração." });
  }
});

module.exports = router;
