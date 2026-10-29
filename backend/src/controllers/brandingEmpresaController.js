"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../../db");
const { DIRS, TAMANHOS_VALIDOS } = require("./brandingController");

// Identidade por empresa (white label). Logo em empresas.logo_url; favicon, icone do iPhone e tamanhos
// em empresas.branding_json (migration 062). Sempre escopado pela empresa do token (req.empresa_id).
const LOCAIS = ["site", "login", "painel"];
const PADRAO_TAMANHOS = { site: "m", login: "g", painel: "m" };
const CAMPOS = { logo: "logo_url", favicon: "favicon_url", apple: "apple_icon_url" };

const tamanhosOk = (t) => {
  const out = { ...PADRAO_TAMANHOS };
  for (const l of LOCAIS) if (TAMANHOS_VALIDOS.includes(t?.[l])) out[l] = t[l];
  return out;
};

function parse(json) {
  try { const o = typeof json === "string" ? JSON.parse(json) : json; return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

/** Identidade crua da empresa (sem fallback para a plataforma). Coluna ausente = sem favicon/tamanhos proprios. */
async function lerEmpresa(empresaId, { db: conn = db } = {}) {
  let row;
  try {
    [[row]] = await conn.execute("SELECT logo_url, branding_json FROM empresas WHERE id = ?", [empresaId]);
  } catch (err) {
    if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
    [[row]] = await conn.execute("SELECT logo_url FROM empresas WHERE id = ?", [empresaId]);
  }
  const b = parse(row?.branding_json);
  return { logo_url: row?.logo_url || null, favicon_url: b.favicon_url || null, apple_icon_url: b.apple_icon_url || null, tamanhos: tamanhosOk(b.tamanhos) };
}

/** Publico (por slug): identidade da empresa por cima da plataforma; o que a empresa nao enviou cai na plataforma. */
function mesclar(plataforma, e) {
  if (!e) return plataforma;
  return {
    ...plataforma,
    logo_url: e.logo_url || plataforma.logo_url,
    favicon_url: e.favicon_url || plataforma.favicon_url,
    apple_icon_url: e.apple_icon_url || plataforma.apple_icon_url,
    tamanhos: e.logo_url ? e.tamanhos : plataforma.tamanhos,
  };
}

function removerArquivo(empresaId, url) {
  const nome = path.basename(String(url || ""));
  if (!nome.startsWith(`empresa-${empresaId}-`)) return; // so apaga arquivos desta empresa
  for (const d of DIRS) { try { fs.unlinkSync(path.join(d, nome)); } catch { /* ja removido */ } }
}

async function gravarBranding(empresaId, parcial) {
  const [[row]] = await db.execute("SELECT branding_json FROM empresas WHERE id = ?", [empresaId]);
  const novo = { ...parse(row?.branding_json), ...parcial };
  await db.execute("UPDATE empresas SET branding_json = ? WHERE id = ?", [JSON.stringify(novo), empresaId]);
}

const falhaMigration = (res, err) => {
  if (err.code === "ER_BAD_FIELD_ERROR") return res.status(503).json({ message: "Rode a migration 062 no servidor (node migrations/062_empresas_branding.js)." });
  console.error("[branding-empresa]", err.message);
  return res.status(500).json({ message: "Erro ao salvar a identidade da empresa." });
};

exports.obter = async (req, res) => {
  try { res.json(await lerEmpresa(req.empresa_id)); } catch (err) { falhaMigration(res, err); }
};

exports.atualizarTamanhos = async (req, res) => {
  const t = req.body?.tamanhos;
  if (!t || typeof t !== "object") return res.status(400).json({ message: "Tamanhos inválidos." });
  for (const [l, v] of Object.entries(t)) {
    if (!LOCAIS.includes(l) || !TAMANHOS_VALIDOS.includes(v)) return res.status(400).json({ message: "Tamanho de logo inválido." });
  }
  try {
    const atual = await lerEmpresa(req.empresa_id);
    await gravarBranding(req.empresa_id, { tamanhos: tamanhosOk({ ...atual.tamanhos, ...t }) });
    res.json(await lerEmpresa(req.empresa_id));
  } catch (err) { falhaMigration(res, err); }
};

/** Handlers de envio/remocao de logo, favicon ou icone do iPhone da propria empresa. */
function handlers(tipo, msgSemArquivo) {
  const campo = CAMPOS[tipo];
  return {
    enviar: async (req, res) => {
      if (!req.file) return res.status(400).json({ message: msgSemArquivo });
      try {
        const arquivo = req.file.filename;
        try { fs.copyFileSync(path.join(DIRS[0], arquivo), path.join(DIRS[1], arquivo)); } catch { /* ok */ }
        const atual = await lerEmpresa(req.empresa_id);
        const url = `/uploads/logos/${arquivo}`;
        if (tipo === "logo") await db.execute("UPDATE empresas SET logo_url = ? WHERE id = ?", [url, req.empresa_id]);
        else await gravarBranding(req.empresa_id, { [campo]: url });
        removerArquivo(req.empresa_id, atual[campo]);
        res.json(await lerEmpresa(req.empresa_id));
      } catch (err) { falhaMigration(res, err); }
    },
    remover: async (req, res) => {
      try {
        const atual = await lerEmpresa(req.empresa_id);
        if (tipo === "logo") await db.execute("UPDATE empresas SET logo_url = NULL WHERE id = ?", [req.empresa_id]);
        else await gravarBranding(req.empresa_id, { [campo]: null });
        removerArquivo(req.empresa_id, atual[campo]);
        res.json(await lerEmpresa(req.empresa_id));
      } catch (err) { falhaMigration(res, err); }
    },
  };
}
exports.logo = handlers("logo", "Envie uma imagem (JPG, PNG ou WEBP, até 2 MB).");
exports.favicon = handlers("favicon", "Envie o favicon (PNG, ICO ou WEBP, até 512 KB).");
exports.apple = handlers("apple", "Envie o ícone do iPhone (PNG, até 1 MB).");
exports.lerEmpresa = lerEmpresa;
exports.mesclar = mesclar;
exports.tamanhosOk = tamanhosOk;
