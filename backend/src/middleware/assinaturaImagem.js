"use strict";

const fs = require("fs");
const { arquivoConfere } = require("../utils/campanhaValidacao");

/** Depois do multer: confere os magic bytes do arquivo (o mimetype vem do cliente). Apaga e recusa se nao bater. */
module.exports = function assinaturaImagem(req, res, next) {
  if (req.file && !arquivoConfere(req.file.path, req.file.mimetype)) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignora */ }
    return res.status(400).json({ message: "O conteúdo do arquivo não corresponde a uma imagem válida" });
  }
  next();
};
