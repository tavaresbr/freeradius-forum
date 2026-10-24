require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const path = require('path')
const { loginLimiter, registroLimiter, publicApiLimiter, updateCheckLimiter } = require('./src/middleware/rateLimiters')
const app = express()

// Atras do nginx: confia no primeiro proxy pra obter o IP real do cliente
// (necessario pro rate-limit por IP e pros logs de compliance).
app.set('trust proxy', 1)

// Prevenir crash do processo por erros não tratados do node-routeros (!empty)
process.on('uncaughtException', (err) => {
  if (err.errno === 'UNKNOWNREPLY' || (err.message && err.message.includes('!empty'))) {
    console.warn('RouterOS !empty reply handled (non-fatal)');
    return;
  }
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Middlewares
const auth = require('./src/middleware/auth')
const tenant = require('./src/middleware/tenant')

// Rotas
const authRoutes = require('./src/routes/authRoutes')
const planRoutes = require('./src/routes/planRoutes')
const adminRoutes = require("./routes/admin")
const mikrotikRoutes = require("./src/routes/mikrotikRoutes");
const efiRoutes = require("./src/routes/efiRoutes");
const mercadoPagoRoutes = require("./src/routes/mercadoPagoRoutes");
const planPublicRoutes = require("./src/routes/planPublicRoutes");
const pagamentoRoutes = require("./src/routes/pagamentoRoutes");
const radiusRoutes = require('./src/routes/radiusRoutes');
const dashboardRoutes = require("./src/routes/dashboardRoutes");
const lgpdRoutes = require("./src/routes/lgpdRoutes");
const whatsappRoutes = require("./src/routes/whatsappRoutes");
const authTempRoutes = require("./src/routes/authTempRoutes");
const limpezaRoutes = require("./src/routes/limpezaRoutes");
const radiusLogsRoutes = require("./src/routes/radiusLogsRoutes");
const adminUserRoutes = require("./src/routes/adminUserRoutes");
const wireguardRoutes = require("./src/routes/wireguardRoutes");
const portalRoutes = require("./src/routes/portalRoutes");
const portalTemplateRoutes = require("./src/routes/portalTemplateRoutes");
const campanhasRoutes = require("./src/routes/campanhasRoutes");
const campanhasPublicRoutes = require("./src/routes/campanhasPublicRoutes");
const leadRoutes = require("./src/routes/leadRoutes");
const importacaoRoutes = require("./src/routes/importacaoRoutes");
const complianceRoutes = require("./src/routes/complianceRoutes");
const empresaRoutes = require("./src/routes/empresaRoutes");
const empresaConfigRoutes = require("./src/routes/empresaConfigRoutes");
const registroRoutes = require("./src/routes/registroRoutes");
const grupoPermissaoRoutes = require("./src/routes/grupoPermissaoRoutes");
const loginPortalRoutes = require("./src/routes/loginPortalRoutes");
const systemBackupRoutes = require("./src/routes/systemBackupRoutes");
const systemUpdateRoutes = require("./src/routes/systemUpdateRoutes");
const logsRoutes = require("./src/routes/logsRoutes");
const db = require("./db");
const { detectPortalVendor } = require("./src/utils/portalVendor");
const { salvarContextoPortal } = require("./src/gateways/gatewayLiberacao");

// Rotas exclusivas do servidor principal (OTA updates) - não existem nos servidores de alunos
const fs = require('fs');
const updatePublishRoutes = fs.existsSync(__dirname + '/src/routes/updatePublishRoutes.js') ? require("./src/routes/updatePublishRoutes") : null;
const updateCheckRoutes = fs.existsSync(__dirname + '/src/routes/updateCheckRoutes.js') ? require("./src/routes/updateCheckRoutes") : null;

// Helmet: cabeçalhos de seguranca. CSP fica desligada aqui (a CSP das rotas que
// servem HTML de portal e aplicada especificamente nelas, sem quebrar os portais);
// CORP liberado pra permitir carregar logos/imagens de outra origem.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}))

// CORS com allowlist. Origens permitidas via env CORS_ORIGINS (separadas por
// virgula) + localhost pra dev. Requisicoes sem Origin (curl, apps, webhooks
// server-to-server) sao permitidas. Origens cross-site nao listadas nao recebem
// os cabecalhos CORS (o browser bloqueia a leitura); same-origin nunca passa por
// CORS, entao painel/portais no mesmo dominio funcionam normalmente.
const corsAllowlist = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true)
    if (corsAllowlist.includes(origin)) return cb(null, true)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true)
    return cb(null, false)
  },
}
app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' }))

// Servir arquivos de campanhas (publicos, com cache de 1 dia)
app.use('/uploads/campanhas',
  express.static(path.join(__dirname, 'uploads', 'campanhas'), {
    maxAge: '1d',
    fallthrough: false,
  })
);

// --- Rate limiting nos endpoints publicos sensiveis (antes dos mounts) ---
app.use('/api/admin/login', loginLimiter)         // login admin (routes/admin.js)
app.use('/api/auth/login', loginLimiter)          // login admin (authRoutes)
app.use('/api/auth/temp', publicApiLimiter)       // acesso temporario
app.use('/api/login-portal/auth', publicApiLimiter)   // login portal wifi (muitos clientes por IP do estabelecimento)
app.use('/api/registro', registroLimiter)         // registro de empresa
app.use('/api/pagamentos', publicApiLimiter)      // captive portal (gerar/status/pix-trial/webhook)

// --- Rotas públicas (sem auth) ---
app.use('/api/admin', adminRoutes)          // Login
app.use('/api/auth', authRoutes)            // Auth
app.use('/api/auth', authTempRoutes)        // Acesso temporário
app.use("/api/planos-publicos", planPublicRoutes);
app.use("/api/pagamentos", pagamentoRoutes);  // Inclui webhook público
app.use("/api/lgpd", lgpdRoutes);             // LGPD login/cadastro são públicos
app.use("/api/registro", registroRoutes);       // Registro público de empresas

app.use("/api/public/campanha", campanhasPublicRoutes);

// Rota pública para login do portal Lead (sem auth)
const { leadLogin, capturaPassiva, cadastroCliente } = require("./src/controllers/leadController");
app.post("/api/lead-portal/login", leadLogin);
app.post("/api/lead-portal/passivo", capturaPassiva);
app.post("/api/clientes/cadastro", cadastroCliente);

// Rota pública para login do portal Wifi/Radius
app.use("/api/login-portal", loginPortalRoutes);

// --- Rotas protegidas (auth + tenant + permissão) ---
const checkPermissao = require('./src/middleware/checkPermissao');

// Downloads/previews abertos via window.open (sem header Authorization): usam
// token de download curto (purpose='download', 120s) emitido por rota protegida.
// Registrados ANTES dos mounts /api/leads e /api/portais pra casar primeiro.
const { issueDownloadToken, verifyDownloadToken } = require('./src/middleware/downloadToken');
const leadCtrlDl = require('./src/controllers/leadController');
const portalCtrlDl = require('./src/controllers/portalController');
app.get('/api/auth/download-token', auth, tenant, issueDownloadToken);
app.get('/api/leads/export', verifyDownloadToken, leadCtrlDl.exportarLeadsCSV);
app.get('/api/lgpd/export', verifyDownloadToken, require('./src/controllers/lgpdController').exportarLgpdCSV);
app.get('/api/portais/:id/preview', verifyDownloadToken, portalCtrlDl.previewPortal);

app.use('/api/planos', auth, tenant, checkPermissao('planos'), planRoutes)
app.use("/api/mikrotiks", auth, tenant, checkPermissao('mikrotiks'), mikrotikRoutes);
app.use("/api/efi", auth, tenant, checkPermissao('configuracoes'), efiRoutes);
app.use("/api/config-mercadopago", auth, tenant, checkPermissao('configuracoes'), mercadoPagoRoutes);
app.use('/api/radius', auth, tenant, radiusRoutes);
app.use("/api/dashboard", auth, tenant, checkPermissao('dashboard'), dashboardRoutes);
app.use("/api/whatsapp", auth, tenant, checkPermissao('configuracoes'), whatsappRoutes);
app.use("/api/limpeza", auth, tenant, checkPermissao('configuracoes'), limpezaRoutes);
app.use("/api/radius-logs", auth, tenant, checkPermissao('sessoeslog'), radiusLogsRoutes);
app.use("/api/admins", auth, tenant, checkPermissao('usuarios'), adminUserRoutes);
app.use("/api/wireguard", auth, tenant, checkPermissao('vpn'), wireguardRoutes);
app.use("/api/portais", auth, tenant, checkPermissao('portais'), portalRoutes);
app.use("/api/campanhas", auth, tenant, checkPermissao('portais'), campanhasRoutes);
app.use("/api/portal-templates", auth, tenant, checkPermissao('portais'), portalTemplateRoutes);
app.use("/api/leads", auth, tenant, checkPermissao('leads'), leadRoutes);
app.use("/api/clientes-import", auth, tenant, checkPermissao('leads'), importacaoRoutes);
app.use("/api/compliance", auth, tenant, checkPermissao('compliance'), complianceRoutes);
app.use("/api/empresa-config", auth, tenant, checkPermissao('configuracoes'), empresaConfigRoutes);

// Rota pública: config visual do portal (sem auth)
const portalCtrl = require("./src/controllers/portalController");
app.get("/api/portal-config/:tipo", portalCtrl.getPortalConfig);

// --- Rotas super admin ---
app.use("/api/empresas", empresaRoutes);  // Auth + authorize interno
app.use("/api/grupos-permissao", grupoPermissaoRoutes); // Auth + authorize interno
app.use("/api/system-backup", systemBackupRoutes);
app.use("/api/system-update", systemUpdateRoutes);
app.use("/api/logs", logsRoutes);
if (updatePublishRoutes) app.use("/api/update-publish", updatePublishRoutes);
if (updateCheckRoutes) app.use("/api/updates", updateCheckLimiter, updateCheckRoutes);

// Endpoint público: serve login.html para MikroTik baixar via /tool/fetch
// Este HTML é salvo como hotspot/login.html no MikroTik
// O RouterOS substitui $(mac), $(ip), $(username) etc antes de servir ao cliente
app.get("/api/hotspot-login/:mikrotikId", async (req, res) => {
  const { mikrotikId } = req.params;
  try {
    const [[mikrotik]] = await db.execute(
      `SELECT m.empresa_id, e.slug AS empresa_slug FROM mikrotiks m
       LEFT JOIN empresas e ON m.empresa_id = e.id WHERE m.id = ?`,
      [mikrotikId]
    );
    const empresaId = mikrotik?.empresa_id || '';
    const empresaSlug = mikrotik?.empresa_slug || 'default';
    const systemDomain = process.env.SYSTEM_DOMAIN || req.hostname;
    const portalUrl = `https://${systemDomain}/hotspot/redirect/${mikrotikId}`;
    const fullUrl = `${portalUrl}?mac=$(mac)&ip=$(ip)&mikrotik_id=${mikrotikId}&empresa_id=${empresaId}&empresa=${empresaSlug}`;

    // HTML no padrão MikroTik hotspot login.html
    // $(mac), $(ip), $(username), $(link-login), $(link-orig) são variáveis do RouterOS
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="pragma" content="no-cache">
  <meta http-equiv="expires" content="-1">
  <title>Hotspot Login</title>
  <style>
    body { background: #0f111a; color: #fff; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { text-align: center; padding: 40px; max-width: 400px; }
    .spinner { width: 40px; height: 40px; border: 4px solid #333; border-top: 4px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: #3b82f6; }
    .info { font-size: 12px; color: #666; margin-top: 15px; }
  </style>
  <script>
    // Se ja tem username = usuario ja autenticou, ir para status
    var params = new URLSearchParams(window.location.search);
    if (params.has("username") && params.get("username") !== "") {
      window.location.href = "/status";
    } else {
      // Redirect para o portal da empresa
      setTimeout(function() {
        window.location.href = "${fullUrl}";
      }, 1500);
    }
  </script>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <h2>Conectando...</h2>
    <p>Redirecionando para o portal de acesso</p>
    <p class="info">MAC: $(mac) | IP: $(ip)</p>
    <p class="info">Se nao for redirecionado, <a href="${fullUrl}">clique aqui</a></p>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(html);
  } catch (err) {
    res.status(500).send("<h1>Erro</h1>");
  }
});

// Endpoint público: serve status.html para MikroTik baixar via /tool/fetch
// O RouterOS substitui $(username), $(ip), $(uptime), $(bytes-in-nice), etc
app.get("/api/hotspot-status/:mikrotikId", async (req, res) => {
  try {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="pragma" content="no-cache">
  <meta http-equiv="expires" content="-1">
  $(if refresh-timeout)<meta http-equiv="refresh" content="$(refresh-timeout-secs)">$(endif)
  <title>Status - Hotspot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f111a; color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1d27; border: 1px solid #2d3348; border-radius: 16px;
      padding: 32px; max-width: 420px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .header { text-align: center; margin-bottom: 24px; }
    .avatar {
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px; font-size: 24px; color: white; font-weight: bold;
    }
    .header h1 { font-size: 20px; font-weight: 700; color: #f1f5f9; }
    .header p { font-size: 13px; color: #64748b; margin-top: 4px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: #065f46; color: #6ee7b7; padding: 4px 12px;
      border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 8px;
    }
    .status-dot { width: 8px; height: 8px; background: #34d399; border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; }
    .stat {
      background: #0d1117; border: 1px solid #2d3348; border-radius: 12px; padding: 16px;
      text-align: center;
    }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .stat-value { font-size: 18px; font-weight: 700; color: #f1f5f9; }
    .stat-value.blue { color: #60a5fa; }
    .stat-value.green { color: #34d399; }
    .stat-value.orange { color: #fb923c; }
    .info-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid #1e2235;
      font-size: 13px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; }
    .info-value { color: #e2e8f0; font-weight: 500; font-family: monospace; }
    .btn-logout {
      display: block; width: 100%; padding: 14px;
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      color: white; border: none; border-radius: 12px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      margin-top: 20px; transition: all 0.2s;
    }
    .btn-logout:hover { opacity: 0.9; transform: translateY(-1px); }
    .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #475569; }
    $(if refresh-timeout).refresh-bar {
      height: 3px; background: #1e293b; border-radius: 2px; margin-top: 16px; overflow: hidden;
    }
    .refresh-bar-fill {
      height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa);
      animation: refill $(refresh-timeout-secs)s linear infinite;
    }
    @keyframes refill { from { width: 0%; } to { width: 100%; } }
    $(endif)
  </style>
  <script>
    $(if advert-pending == 'yes')
    function openAdvert() {
      window.open('$(link-advert)', 'hotspot_advert', '');
    }
    $(endif)
    function doLogout() {
      if (window.name == 'hotspot_status') {
        window.open('$(link-logout)', 'hotspot_logout', 'toolbar=0,location=0,status=0,menubar=0,resizable=1,width=300,height=200');
        window.close();
        return false;
      }
      return true;
    }
  </script>
</head>
<body $(if advert-pending == 'yes')onload="openAdvert()"$(endif)>
  <div class="card">
    <div class="header">
      <div class="avatar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
      </div>
      $(if login-by == 'trial')
        <h1>Acesso Trial</h1>
      $(elif login-by != 'mac')
        <h1>$(username)</h1>
      $(else)
        <h1>Conectado</h1>
      $(endif)
      <p>Sessao hotspot ativa</p>
      <div class="status-badge">
        <span class="status-dot"></span>
        Online
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Tempo Online</div>
        <div class="stat-value green">$(uptime)</div>
      </div>
      $(if session-time-left)
      <div class="stat">
        <div class="stat-label">Tempo Restante</div>
        <div class="stat-value orange">$(session-time-left)</div>
      </div>
      $(else)
      <div class="stat">
        <div class="stat-label">IP</div>
        <div class="stat-value blue">$(ip)</div>
      </div>
      $(endif)
      <div class="stat">
        <div class="stat-label">Download</div>
        <div class="stat-value blue">$(bytes-out-nice)</div>
      </div>
      <div class="stat">
        <div class="stat-label">Upload</div>
        <div class="stat-value">$(bytes-in-nice)</div>
      </div>
    </div>

    <div style="background:#0d1117;border:1px solid #2d3348;border-radius:12px;padding:14px;margin-bottom:8px;">
      <div class="info-row">
        <span class="info-label">Endereco IP</span>
        <span class="info-value">$(ip)</span>
      </div>
      <div class="info-row">
        <span class="info-label">MAC Address</span>
        <span class="info-value">$(mac)</span>
      </div>
      $(if session-time-left)
      <div class="info-row">
        <span class="info-label">Conectado / Restante</span>
        <span class="info-value">$(uptime) / $(session-time-left)</span>
      </div>
      $(endif)
      $(if blocked == 'yes')
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value" style="color:#fb923c;">
          <a href="$(link-advert)" target="hotspot_advert" style="color:#fb923c;text-decoration:none;">Publicidade pendente</a>
        </span>
      </div>
      $(elif refresh-timeout)
      <div class="info-row">
        <span class="info-label">Atualiza em</span>
        <span class="info-value">$(refresh-timeout)</span>
      </div>
      $(endif)
    </div>

    $(if login-by-mac != 'yes')
    <form action="$(link-logout)" name="logout" onsubmit="return doLogout()">
      <button type="submit" class="btn-logout">Desconectar</button>
    </form>
    $(endif)

    $(if refresh-timeout)
    <div class="refresh-bar"><div class="refresh-bar-fill"></div></div>
    $(endif)

    <div class="footer">Hotspot WiFi &bull; Protegido por LGPD</div>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(html);
  } catch (err) {
    res.status(500).send("<h1>Erro</h1>");
  }
});

// Endpoint público: redirect dinâmico do captive portal
app.get("/hotspot/redirect/:mikrotikId", async (req, res) => {
  const { mikrotikId } = req.params;
  // Normaliza os params por vendor (MikroTik: mac/ip; Omada: clientMac/apMac;
  // UniFi: id/ap). Sem o tipo do gateway ainda -> deteccao por parametro.
  let portalCtx = detectPortalVendor(req.query);
  let { mac, ip } = portalCtx;

  try {
    // Busca MikroTik com dados da empresa
    const [[mikrotik]] = await db.execute(
      `SELECT m.*, e.slug AS empresa_slug, e.id AS eid
       FROM mikrotiks m
       LEFT JOIN empresas e ON m.empresa_id = e.id
       WHERE m.id = ?`,
      [mikrotikId]
    );
    if (!mikrotik || !mikrotik.portal_id) {
      return res.status(404).send("<h1>Portal não configurado para este hotspot</h1>");
    }

    // Com o gateway carregado, o `tipo` e' autoritativo: re-normaliza o MAC/IP
    // pelo vendor correto (cobre o caso do param nao bater a heuristica).
    if (mikrotik.tipo && mikrotik.tipo !== portalCtx.vendor) {
      portalCtx = detectPortalVendor(req.query, { tipo: mikrotik.tipo });
      mac = portalCtx.mac;
      ip = portalCtx.ip;
    }

    // Gateway nao-MikroTik: persiste o contexto do redirect (apMac, ssidName,
    // target/targetPort, redirectUrl...). Sem isso o authorize na liberacao
    // (Omada extPortal/auth, browserauth, UniFi authorize-guest) e' impossivel
    // — os params so existem AQUI, minutos antes do cliente concluir o fluxo.
    if (mikrotik.tipo && mikrotik.tipo !== "mikrotik") {
      salvarContextoPortal(portalCtx, { mikrotikId: mikrotik.id, empresaId: mikrotik.empresa_id })
        .catch((e) => console.warn("[redirect] salvarContextoPortal:", e.message));
    }

    const [[portal]] = await db.execute("SELECT * FROM portais WHERE id = ?", [mikrotik.portal_id]);
    if (!portal) {
      return res.status(404).send("<h1>Portal não encontrado</h1>");
    }

    const empresaId = mikrotik.empresa_id;
    const empresaSlug = mikrotik.empresa_slug || 'default';

    // Pré-portal: se o portal tem campanha ativa e usuario ainda nao viu, redireciona
    if (portal.campanha_ativa_id && req.query.campanha_vista !== '1') {
      const qs = new URLSearchParams({
        mac: mac || '',
        ip: ip || '',
        mikrotik_id: mikrotikId,
        empresa_id: empresaId,
        empresa: empresaSlug,
      }).toString();
      return res.redirect(302, `/campanha/${portal.id}?${qs}`);
    }

    const params = `mac=${encodeURIComponent(mac || "")}&ip=${encodeURIComponent(ip || "")}&mikrotik_id=${mikrotikId}&empresa_id=${empresaId}&empresa=${empresaSlug}`;

    if (portal.tipo === "custom" && portal.html_content) {
      let html = portal.html_content
        .replace(/\$\(mac\)/g, mac || "")
        .replace(/\$\(ip\)/g, ip || "")
        .replace(/\$\(mikrotik_id\)/g, mikrotikId)
        .replace(/\$\(empresa_id\)/g, empresaId)
        .replace(/\$\(empresa\)/g, empresaSlug);

      // Injetar CSS customizado se existir
      if (portal.custom_css) {
        html = html.replace('</head>', `<style>${portal.custom_css}</style></head>`);
      }

      res.setHeader("Content-Type", "text/html");
      // CSP basica pra HTML de portal (conteudo controlado pelo tenant): impede
      // enquadramento (clickjacking) e nosniff. Mantem inline pra nao quebrar os
      // portais existentes que dependem de <script>/<style> embutidos.
      res.setHeader("Content-Security-Policy", "default-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(html);
    }

    if (portal.url_redirect) {
      const separator = portal.url_redirect.includes("?") ? "&" : "?";
      return res.redirect(`${portal.url_redirect}${separator}${params}`);
    }

    res.status(400).send("<h1>Portal sem configuração de redirect</h1>");
  } catch (err) {
    console.error("Erro no redirect do captive portal:", err);
    res.status(500).send("<h1>Erro interno</h1>");
  }
});


const cron = require('node-cron');
const syncConnectionLogs = require('./src/jobs/syncConnectionLogs');
const limpaSessoesOrfas = require('./src/jobs/limpaSessoesOrfas');

// Sincronizar logs de conexão do RADIUS (Marco Civil) a cada 5 minutos
cron.schedule('*/5 * * * *', () => {
  console.log('[CRON] Iniciando syncConnectionLogs...');
  syncConnectionLogs().catch(err => console.error('[CRON] Erro:', err));
});

// Sincronizar nomes dos APs via API do controller Omada (gateways com API de
// captura configurada em Ações → API Omada) a cada 6 horas
const { sincronizarTodosOmada } = require('./src/services/omadaApNames');
cron.schedule('20 */6 * * *', () => {
  sincronizarTodosOmada().catch(err => console.error('[CRON] Erro sincronizarTodosOmada:', err));
});

// Fechar sessoes orfas do radacct a cada 5 minutos (destrava Simultaneous-Use=1)
cron.schedule('*/5 * * * *', () => {
  limpaSessoesOrfas().catch(err => console.error('[CRON] Erro limpaSessoesOrfas:', err));
});

// Polling de sessoes UniFi -> connection_logs (Marco Civil). O accounting RADIUS
// do UniFi nao e' confiavel; sem este job, gateways UniFi ficam sem compliance e
// o UnifiDriver calcula saldo errado. No-op barato quando nao ha gateway unifi.
const syncUnifiSessions = require('./src/jobs/syncUnifiSessions');
cron.schedule('*/5 * * * *', () => {
  syncUnifiSessions().catch(err => console.error('[CRON] Erro syncUnifiSessions:', err));
});

// --- Tela de emergencia (SEM auth) ---
app.get('/emergency', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/emergency.html'));
});
const systemBackupCtrl = require('./src/controllers/systemBackupController');
const authorizeEmergency = require('./src/middleware/authorize');
app.get('/api/emergency/backups', auth, authorizeEmergency('super_admin'), systemBackupCtrl.listarBackups);
app.post('/api/emergency/backup', auth, authorizeEmergency('super_admin'), systemBackupCtrl.criarBackup);
app.post('/api/emergency/restore/:id', auth, authorizeEmergency('super_admin'), systemBackupCtrl.restaurarBackup);

try {
  const { ensureFreeradiusDict } = require('./src/utils/ensureFreeradiusDict');
  ensureFreeradiusDict();
} catch (err) {
  console.warn('[freeradius-dict] erro inesperado:', err.message);
}

app.listen(process.env.PORT || 3001, () => {
  console.log(`API rodando na porta ${process.env.PORT || 3001}`)
})
