const fs = require("fs");
const path = require("path");
const db = require("../../db");

// Identidade do site (SaaS): nome + logo globais, editaveis so pelo super admin.
// Guardado em plataforma_configs (chave 'branding'); sem migration nova.
const PADRAO = { nome: "Apex Telecom", logo_url: null };
const DIRS = [
  path.join(__dirname, "../../../frontend/dist/uploads/logos"),
  path.join(__dirname, "../../../frontend/public/uploads/logos"),
];
const LOGO_RE = /^\/uploads\/logos\/site-[\w.-]+$/;

async function ler() {
  try {
    const [[row]] = await db.execute("SELECT config_json FROM plataforma_configs WHERE chave = 'branding'");
    if (!row) return { ...PADRAO };
    const c = typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
    return { nome: c?.nome || PADRAO.nome, logo_url: c?.logo_url || null };
  } catch (err) {
    return { ...PADRAO }; // tabela ausente/erro: o site nunca fica sem marca
  }
}

async function gravar(cfg) {
  await db.execute(
    "INSERT INTO plataforma_configs (chave, config_json) VALUES ('branding', ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)",
    [JSON.stringify(cfg)]
  );
}

/** Nome do site: texto simples, 1 a 60 caracteres, sem < ou >. */
function validarNome(valor) {
  const nome = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!nome) return { erro: "Informe o nome do site." };
  if (nome.length > 60) return { erro: "O nome pode ter no máximo 60 caracteres." };
  if (/[<>]/.test(nome)) return { erro: "O nome não pode conter < ou >." };
  return { nome };
}

function removerArquivo(logoUrl) {
  if (!logoUrl || !LOGO_RE.test(logoUrl)) return; // so apaga arquivos que este modulo criou
  const arquivo = path.basename(logoUrl);
  for (const d of DIRS) {
    try { fs.unlinkSync(path.join(d, arquivo)); } catch { /* ja removido */ }
  }
}

exports.obter = async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json(await ler());
};

exports.atualizarNome = async (req, res) => {
  const { nome, erro } = validarNome(req.body?.nome);
  if (erro) return res.status(400).json({ message: erro });
  const cfg = await ler();
  await gravar({ ...cfg, nome });
  res.json({ ...cfg, nome });
};

exports.enviarLogo = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Envie uma imagem (JPG, PNG ou WEBP, até 2 MB)." });
  const arquivo = req.file.filename;
  // multer grava em dist; copia tambem para public (sobrevive a um novo build)
  try { fs.copyFileSync(path.join(DIRS[0], arquivo), path.join(DIRS[1], arquivo)); } catch { /* ok */ }
  const cfg = await ler();
  removerArquivo(cfg.logo_url);
  const novo = { ...cfg, logo_url: `/uploads/logos/${arquivo}` };
  await gravar(novo);
  res.json(novo);
};

exports.removerLogo = async (req, res) => {
  const cfg = await ler();
  removerArquivo(cfg.logo_url);
  const novo = { ...cfg, logo_url: null };
  await gravar(novo);
  res.json(novo);
};

exports.validarNome = validarNome;
exports.DIRS = DIRS;
