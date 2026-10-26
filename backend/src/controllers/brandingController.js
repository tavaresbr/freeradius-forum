const fs = require("fs");
const path = require("path");
const db = require("../../db");

// Identidade do site (SaaS): nome + logo globais, editaveis so pelo super admin.
// Guardado em plataforma_configs (chave 'branding'); sem migration nova.
const TAMANHOS_VALIDOS = ["p", "m", "g", "xg"];
const TAMANHOS_PADRAO = { site: "m", login: "g", painel: "m" };
const PADRAO = { nome: "Apex Telecom", logo_url: null, favicon_url: null, apple_icon_url: null, tamanhos: { ...TAMANHOS_PADRAO } };
const DIRS = [
  path.join(__dirname, "../../../frontend/dist/uploads/logos"),
  path.join(__dirname, "../../../frontend/public/uploads/logos"),
];
const LOGO_RE = /^\/uploads\/logos\/(site|favicon|apple)-[\w.-]+$/;
// Arquivos de identidade: campo da config -> (o prefixo do arquivo e definido na rota)
const CAMPOS = { logo: "logo_url", favicon: "favicon_url", apple: "apple_icon_url" };

/** Preset de tamanho por local (site/login/painel); valor ausente ou invalido cai no padrao. */
function normalizarTamanhos(t) {
  const out = { ...TAMANHOS_PADRAO };
  for (const local of Object.keys(TAMANHOS_PADRAO)) {
    if (TAMANHOS_VALIDOS.includes(t?.[local])) out[local] = t[local];
  }
  return out;
}

async function ler() {
  try {
    const [[row]] = await db.execute("SELECT config_json FROM plataforma_configs WHERE chave = 'branding'");
    if (!row) return { ...PADRAO, tamanhos: { ...TAMANHOS_PADRAO } };
    const c = typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
    return { nome: c?.nome || PADRAO.nome, logo_url: c?.logo_url || null, favicon_url: c?.favicon_url || null, apple_icon_url: c?.apple_icon_url || null, tamanhos: normalizarTamanhos(c?.tamanhos) };
  } catch (err) {
    return { ...PADRAO, tamanhos: { ...TAMANHOS_PADRAO } }; // tabela ausente/erro: o site nunca fica sem marca
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

/** PUT: nome e/ou tamanhos da logo; so grava o que veio e preserva o resto (logo inclusive). */
exports.atualizar = async (req, res) => {
  const body = req.body || {};
  const cfg = await ler();
  const novo = { ...cfg };
  if ("nome" in body) {
    const { nome, erro } = validarNome(body.nome);
    if (erro) return res.status(400).json({ message: erro });
    novo.nome = nome;
  }
  if ("tamanhos" in body) {
    const t = body.tamanhos;
    if (!t || typeof t !== "object") return res.status(400).json({ message: "Tamanhos inválidos." });
    for (const [local, v] of Object.entries(t)) {
      if (!(local in TAMANHOS_PADRAO) || !TAMANHOS_VALIDOS.includes(v)) {
        return res.status(400).json({ message: "Tamanho de logo inválido." });
      }
    }
    novo.tamanhos = normalizarTamanhos({ ...cfg.tamanhos, ...t });
  }
  if (!("nome" in body) && !("tamanhos" in body)) return res.status(400).json({ message: "Nada para atualizar." });
  await gravar(novo);
  res.json(novo);
};
exports.atualizarNome = exports.atualizar;

/** Gera os handlers de envio/remocao de um arquivo de identidade (logo, favicon, icone do iPhone). */
function handlers(tipo, rotuloErro) {
  const campo = CAMPOS[tipo];
  return {
    enviar: async (req, res) => {
      if (!req.file) return res.status(400).json({ message: rotuloErro });
      const arquivo = req.file.filename;
      // multer grava em dist; copia tambem para public (sobrevive a um novo build)
      try { fs.copyFileSync(path.join(DIRS[0], arquivo), path.join(DIRS[1], arquivo)); } catch { /* ok */ }
      const cfg = await ler();
      removerArquivo(cfg[campo]);
      const novo = { ...cfg, [campo]: `/uploads/logos/${arquivo}` };
      await gravar(novo);
      res.json(novo);
    },
    remover: async (req, res) => {
      const cfg = await ler();
      removerArquivo(cfg[campo]);
      const novo = { ...cfg, [campo]: null };
      await gravar(novo);
      res.json(novo);
    },
  };
}
const logo = handlers("logo", "Envie uma imagem (JPG, PNG ou WEBP, até 2 MB).");
const favicon = handlers("favicon", "Envie o favicon (PNG, ICO ou WEBP, até 512 KB).");
const apple = handlers("apple", "Envie o ícone do iPhone (PNG, até 1 MB).");
exports.enviarLogo = logo.enviar;
exports.removerLogo = logo.remover;
exports.enviarFavicon = favicon.enviar;
exports.removerFavicon = favicon.remover;
exports.enviarIconeApple = apple.enviar;
exports.removerIconeApple = apple.remover;

exports.validarNome = validarNome;
exports.TAMANHOS_VALIDOS = TAMANHOS_VALIDOS;
exports.DIRS = DIRS;
