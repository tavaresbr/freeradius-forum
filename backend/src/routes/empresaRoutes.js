const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const exigeDonoPlataforma = require("../middleware/exigeDonoPlataforma");
const multer = require("multer");
const path = require("path");
const {
  listarEmpresas,
  criarEmpresa,
  atualizarEmpresa,
  deletarEmpresa,
  obterEmpresa,
  listarAdminsEmpresa,
  vincularAdmin,
  desvincularAdmin,
  listarTodosAdmins
} = require("../controllers/empresaController");
const db = require("../../db");

// Multer para upload de logo
const uploadsDir = path.join(__dirname, '../../../frontend/dist/uploads/logos');
const publicUploadsDir = path.join(__dirname, '../../../frontend/public/uploads/logos');
const fs = require('fs');
// Garantir que os diretórios existam
[uploadsDir, publicUploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Extensao derivada do MIME real (nao do nome do arquivo). SVG bloqueado (XSS).
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || '.bin';
    const id = parseInt(req.params.id, 10) || 0;
    cb(null, `empresa-${id}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (MIME_EXT[file.mimetype]) cb(null, true);
  else cb(new Error('Apenas imagens JPG, PNG, GIF ou WEBP são permitidas'));
}});

// Rota com auth (não precisa ser super_admin): buscar empresa por slug (sidebar)
router.get("/by-slug/:slug", auth, async (req, res) => {
  try {
    const [[empresa]] = await db.execute('SELECT id, nome, slug, logo_url FROM empresas WHERE slug = ?', [req.params.slug]);
    if (!empresa) return res.status(404).json({ message: "Empresa não encontrada" });

    // Isolamento multi-tenant: super_admin ve qualquer empresa; os demais so
    // podem consultar a propria empresa (empresa_id do JWT) ou uma a que estejam
    // vinculados (admin_empresas). Sem isso, qualquer admin logado enumerava
    // todas as empresas por slug.
    if (req.user.role !== 'super_admin') {
      let permitido = Number(empresa.id) === Number(req.user.empresa_id);
      if (!permitido) {
        const [[vinculo]] = await db.execute(
          'SELECT 1 AS ok FROM admin_empresas WHERE admin_id = ? AND empresa_id = ? LIMIT 1',
          [req.user.id, empresa.id]
        );
        permitido = !!vinculo;
      }
      if (!permitido) return res.status(403).json({ message: "Acesso negado" });
    }

    res.json(empresa);
  } catch (err) {
    res.status(500).json({ message: "Erro" });
  }
});

// Logomarca da PROPRIA empresa (white label): o Administrador troca a sua sem afetar as outras.
// A empresa vem so do token (tenant), nunca da URL/corpo.
const tenant = require("../middleware/tenant");
const exigeAssinatura = require("../middleware/assinatura");
const checkPermissao = require("../middleware/checkPermissao");
const uploadMinha = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `empresa-${parseInt(req.empresa_id, 10) || 0}-${Date.now()}${MIME_EXT[file.mimetype] || '.bin'}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (MIME_EXT[file.mimetype] ? cb(null, true) : cb(new Error('Apenas imagens JPG, PNG ou WEBP são permitidas'))),
});
const permissaoMinhaLogo = [auth, tenant, exigeAssinatura, checkPermissao('configuracoes')];

// Apaga o arquivo antigo da empresa (so dentro de /uploads/logos e so os dela).
function apagarLogoAntiga(empresaId, logoUrl) {
  const nome = path.basename(String(logoUrl || ''));
  if (!nome.startsWith(`empresa-${empresaId}-`)) return;
  for (const d of [uploadsDir, publicUploadsDir]) { try { fs.unlinkSync(path.join(d, nome)); } catch { /* ja removida */ } }
}

router.post("/minha/logo", ...permissaoMinhaLogo, (req, res, next) => {
  uploadMinha.single('logo')(req, res, (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 2 MB' : err.message });
    next();
  });
}, require("../middleware/assinaturaImagem"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
    const logoUrl = `/uploads/logos/${req.file.filename}`;
    fs.copyFileSync(req.file.path, path.join(publicUploadsDir, req.file.filename));
    const [[atual]] = await db.execute('SELECT logo_url FROM empresas WHERE id = ?', [req.empresa_id]);
    await db.execute('UPDATE empresas SET logo_url = ? WHERE id = ?', [logoUrl, req.empresa_id]);
    if (atual) apagarLogoAntiga(req.empresa_id, atual.logo_url);
    res.json({ logo_url: logoUrl });
  } catch (err) {
    console.error('Erro upload logo da empresa:', err.message);
    res.status(500).json({ message: "Erro ao enviar a logomarca" });
  }
});

router.delete("/minha/logo", ...permissaoMinhaLogo, async (req, res) => {
  try {
    const [[atual]] = await db.execute('SELECT logo_url FROM empresas WHERE id = ?', [req.empresa_id]);
    await db.execute('UPDATE empresas SET logo_url = NULL WHERE id = ?', [req.empresa_id]);
    if (atual) apagarLogoAntiga(req.empresa_id, atual.logo_url);
    res.json({ logo_url: null });
  } catch (err) {
    console.error('Erro ao remover logo da empresa:', err.message);
    res.status(500).json({ message: "Erro ao remover a logomarca" });
  }
});

// Todas as rotas abaixo requerem super_admin
router.use(auth, authorize('super_admin'), exigeDonoPlataforma);

router.get("/", listarEmpresas);
router.post("/", criarEmpresa);
router.get("/admins/todos", listarTodosAdmins);
router.get("/:id", obterEmpresa);
router.put("/:id", atualizarEmpresa);
router.delete("/:id", deletarEmpresa);

// Upload de logo
router.post("/:id/logo", upload.single('logo'), require("../middleware/assinaturaImagem"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
    const logoUrl = `/uploads/logos/${req.file.filename}`;
    // Copiar para public/ (persistência entre builds)
    fs.copyFileSync(req.file.path, path.join(publicUploadsDir, req.file.filename));
    await db.execute('UPDATE empresas SET logo_url = ? WHERE id = ?', [logoUrl, req.params.id]);
    res.json({ logo_url: logoUrl });
  } catch (err) {
    console.error('Erro upload logo:', err);
    res.status(500).json({ message: "Erro ao fazer upload" });
  }
});

// Vinculação admin <-> empresa
router.get("/:id/admins", listarAdminsEmpresa);
router.post("/:id/vincular-admin", vincularAdmin);
router.delete("/:id/desvincular-admin/:adminId", desvincularAdmin);

module.exports = router;
