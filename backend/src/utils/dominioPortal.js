// Dominio proprio do portal (SaaS): validacao, conferencia de DNS, certificado (certbot) e vhost do nginx.
// Roda no servidor do sistema (backend como root). NUNCA usa shell: argumentos sempre em array, host ja validado.
const path = require("path");
const fs = require("fs");
const dns = require("dns").promises;
const { execFile } = require("child_process");

const RAIZ = path.resolve(__dirname, "../../..");
const TEMPLATE = path.join(RAIZ, "infra", "nginx", "dominio-portal.conf.tpl");
const NGINX_CONF_DIR = process.env.NGINX_CONF_DIR || "/etc/nginx/conf.d";
const NGINX_SNIPPETS_DIR = process.env.NGINX_SNIPPETS_DIR || "/etc/nginx/snippets";
const LOG_CERTBOT = process.env.CERTBOT_LOG || "/var/log/letsencrypt/letsencrypt.log";
const TIMEOUT_CERTBOT_MS = 120000;
// Mesmo conteudo do install.sh; servidores instalados antes do hardening nao tem o arquivo e o vhost o inclui.
const SNIPPET_SEGURANCA = `server_tokens off;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
`;

const sistema = () => String(process.env.SYSTEM_DOMAIN || "").trim().toLowerCase();

/** Valida e normaliza o dominio informado. Devolve { host } ou { erro }. */
function validarDominio(entrada) {
  if (typeof entrada !== "string") return { erro: "Informe o domínio." };
  const host = entrada.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return { erro: "Informe o domínio." };
  if (host.length > 253) return { erro: "Domínio muito longo." };
  if (/[\s/:@?#\\]/.test(host)) return { erro: "Informe só o domínio, sem http://, porta ou caminho (ex.: wifi.suaempresa.com.br)." };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { erro: "Use um nome de domínio, não um endereço IP." };
  const labels = host.split(".");
  if (labels.length < 2) return { erro: "Domínio inválido." };
  for (const l of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return { erro: "Domínio inválido (use só letras, números e hífen)." };
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return { erro: "Domínio inválido." };
  if (/\.(local|localhost|internal|lan|test|invalid|example)$/.test(host) || host === "localhost") {
    return { erro: "Este domínio não é público." };
  }
  const sys = sistema();
  if (sys && (host === sys || host.endsWith(`.${sys}`))) {
    return { erro: "Não use o domínio da plataforma; informe um domínio seu." };
  }
  return { host };
}

/** O dominio aponta para este servidor? (CNAME para o SYSTEM_DOMAIN ou A/AAAA com o mesmo IP.) */
async function verificarDns(host, { resolver = dns } = {}) {
  const sys = sistema();
  if (!sys) return { ok: false, mensagem: "SYSTEM_DOMAIN não configurado no servidor." };
  const lista = async (fn, ...a) => { try { return await resolver[fn](...a); } catch { return []; } };
  const cnames = (await lista("resolveCname", host)).map((c) => String(c).toLowerCase().replace(/\.$/, ""));
  if (cnames.some((c) => c === sys)) return { ok: true, tipo: "CNAME", encontrado: cnames };
  const [mine4, mine6] = await Promise.all([lista("resolve4", sys), lista("resolve6", sys)]);
  const [her4, her6] = await Promise.all([lista("resolve4", host), lista("resolve6", host)]);
  const meu = new Set([...mine4, ...mine6]);
  const dele = [...her4, ...her6];
  if (dele.some((ip) => meu.has(ip))) return { ok: true, tipo: "A", encontrado: dele };
  const achou = [...cnames, ...dele];
  return {
    ok: false,
    encontrado: achou,
    mensagem: achou.length
      ? `O domínio aponta para ${achou.join(", ")}, não para este servidor. Ajuste o DNS e tente de novo (pode levar alguns minutos).`
      : "Não encontramos registro DNS para este domínio ainda. Crie o apontamento e tente de novo (pode levar alguns minutos).",
  };
}

const run = (exec, cmd, args, opts = {}) => new Promise((resolve, reject) => {
  exec(cmd, args, { timeout: opts.timeout || 60000, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ""); return reject(err); }
    resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
  });
});

let ocupado = false; // 1 emissao por vez (certbot usa lock proprio e e' lento)
async function comLock(fn) {
  if (ocupado) throw Object.assign(new Error("Outra ativação de domínio está em andamento. Tente novamente em instantes."), { seguro: true });
  ocupado = true;
  try { return await fn(); } finally { ocupado = false; }
}

/** Cria o snippet de seguranca do nginx se faltar (nunca sobrescreve um existente). */
function garantirSnippetSeguranca({ fsx = fs, dir = NGINX_SNIPPETS_DIR } = {}) {
  const arquivo = path.join(dir, "hotspot-security.conf");
  if (fsx.existsSync(arquivo)) return false;
  fsx.mkdirSync(dir, { recursive: true });
  fsx.writeFileSync(arquivo, SNIPPET_SEGURANCA, { mode: 0o644 });
  return true;
}

const arquivoDesafio = (dir, host) => path.join(dir, `hotspot-acme-${host}.conf`);

/**
 * Garante que a porta 80 responde o desafio HTTP-01 para ESTE host, sem depender do server default do nginx
 * (o bloco gerado pelo Certbot tem `return 404` no nivel do server e nega o desafio). Um server com server_name
 * exato vence o default_server. nginx -t antes do reload; se falhar remove o arquivo.
 */
async function garantirDesafioHttp(host, { exec = execFile, fsx = fs, dir = NGINX_CONF_DIR, webroot } = {}) {
  const v = validarDominio(host);
  if (v.erro) throw Object.assign(new Error(v.erro), { seguro: true });
  const raiz = webroot || path.join(RAIZ, "frontend", "dist");
  const arquivo = arquivoDesafio(dir, v.host);
  const conteudo = `# Gerado pelo painel (utils/dominioPortal.garantirDesafioHttp): desafio HTTP-01 do Let's Encrypt para ${v.host}.
server {
    listen 80;
    server_name ${v.host};

    location ^~ /.well-known/acme-challenge/ {
        root ${raiz};
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
`;
  const anterior = fsx.existsSync(arquivo) ? fsx.readFileSync(arquivo, "utf8") : null;
  if (anterior === conteudo) return arquivo; // ja esta no lugar
  fsx.writeFileSync(arquivo, conteudo, { mode: 0o644 });
  try {
    await run(exec, "nginx", ["-t"]);
    await run(exec, "nginx", ["-s", "reload"]);
  } catch (e) {
    try { fsx.unlinkSync(arquivo); } catch { /* ja removido */ }
    console.error("[dominio] nginx recusou o server da porta 80:", (e.stderr || e.message || "").slice(0, 500));
    throw Object.assign(new Error("O nginx recusou a configuração do domínio (nada foi alterado)."), { seguro: true });
  }
  return arquivo;
}

/** Traduz o ultimo "Detail:" do log do certbot em uma orientacao (sem expor o log). */
function motivoCertbot(texto) {
  const t = String(texto || "");
  const detalhes = t.match(/Detail: .*/g);
  const d = detalhes ? detalhes[detalhes.length - 1] : t;
  if (/too many|rate ?limit/i.test(d) || /too many (certificates|failed)/i.test(t)) return "Limite de emissões do Let's Encrypt atingido. Aguarde cerca de 1 hora e tente de novo.";
  if (/Timeout|Connection refused|Connection reset|No route/i.test(d)) return "O Let's Encrypt não conseguiu acessar a porta 80 do servidor. Libere a porta 80 no firewall e tente de novo.";
  if (/NXDOMAIN|DNS problem|no valid A/i.test(d)) return "O DNS do domínio ainda não aponta para o servidor. Confira o apontamento e tente de novo.";
  if (/404|Invalid response/i.test(d)) return "O servidor respondeu 404 ao desafio do Let's Encrypt na porta 80. Confira a configuração do nginx.";
  return null;
}

function lerMotivoCertbot({ fsx = fs, log = LOG_CERTBOT } = {}) {
  try {
    const stat = fsx.statSync(log);
    const fd = fsx.openSync(log, "r");
    try {
      const n = Math.min(stat.size, 16384);
      const buf = Buffer.alloc(n);
      fsx.readSync(fd, buf, 0, n, stat.size - n);
      return motivoCertbot(buf.toString("utf8"));
    } finally { fsx.closeSync(fd); }
  } catch { return null; }
}

/** Emite o certificado Let's Encrypt (HTTP-01 via webroot; o desafio vem do server da porta 80 criado por garantirDesafioHttp). */
async function emitirCertificado(host, { exec = execFile, webroot } = {}) {
  const v = validarDominio(host);
  if (v.erro) throw Object.assign(new Error(v.erro), { seguro: true });
  const email = process.env.SSL_EMAIL || process.env.CERTBOT_EMAIL;
  if (!email) throw Object.assign(new Error("SSL_EMAIL não configurado no servidor (.env)."), { seguro: true });
  const raiz = webroot || path.join(RAIZ, "frontend", "dist");
  return comLock(async () => {
    try {
      await run(exec, "certbot", [
        "certonly", "--webroot", "-w", raiz, "-d", v.host,
        "--non-interactive", "--agree-tos", "-m", email,
        "--deploy-hook", "systemctl reload nginx",
      ], { timeout: TIMEOUT_CERTBOT_MS });
    } catch (e) {
      console.error("[dominio] certbot falhou:", (e.stderr || e.message || "").slice(0, 500));
      throw Object.assign(new Error(lerMotivoCertbot() || "Não foi possível emitir o certificado. Confira se o DNS já aponta para o servidor e se as portas 80/443 estão abertas."), { seguro: true });
    }
  });
}

/** Renderiza o vhost 443 do dominio; nginx -t antes do reload; se o teste falhar remove o arquivo (nunca deixa o nginx quebrado). */
async function escreverVhost(host, opcoes = {}) {
  const { exec = execFile, fsx = fs, dir = NGINX_CONF_DIR } = opcoes;
  const v = validarDominio(host);
  if (v.erro) throw Object.assign(new Error(v.erro), { seguro: true });
  garantirSnippetSeguranca({ fsx, dir: opcoes.snippetsDir });
  const tpl = fsx.readFileSync(TEMPLATE, "utf8");
  const conteudo = tpl
    .replace(/\{\{HOST\}\}/g, v.host)
    .replace(/\{\{DIST\}\}/g, path.join(RAIZ, "frontend", "dist"))
    .replace(/\{\{BACKEND\}\}/g, path.join(RAIZ, "backend"))
    .replace(/\{\{PORT\}\}/g, String(parseInt(process.env.PORT, 10) || 3001));
  const arquivo = path.join(dir, `hotspot-dominio-${v.host}.conf`);
  fsx.writeFileSync(arquivo, conteudo, { mode: 0o644 });
  try {
    await run(exec, "nginx", ["-t"]);
    await run(exec, "nginx", ["-s", "reload"]);
  } catch (e) {
    try { fsx.unlinkSync(arquivo); } catch { /* ja removido */ }
    console.error("[dominio] nginx recusou o vhost:", (e.stderr || e.message || "").slice(0, 500));
    throw Object.assign(new Error("O nginx recusou a configuração do domínio (nada foi alterado)."), { seguro: true });
  }
  return arquivo;
}

async function removerDominio(host, { exec = execFile, fsx = fs, dir = NGINX_CONF_DIR } = {}) {
  const v = validarDominio(host);
  if (v.erro) return;
  const arquivo = path.join(dir, `hotspot-dominio-${v.host}.conf`);
  try { fsx.unlinkSync(arquivo); } catch { /* nao existia */ }
  try { fsx.unlinkSync(arquivoDesafio(dir, v.host)); } catch { /* nao existia */ }
  try { await run(exec, "nginx", ["-t"]); await run(exec, "nginx", ["-s", "reload"]); } catch (e) { console.error("[dominio] reload apos remover:", e.message); }
  try { await run(exec, "certbot", ["delete", "--cert-name", v.host, "--non-interactive"]); } catch { /* best effort */ }
}

// ---- Qual host o portal da empresa usa (cache 60 s) ----
const cache = new Map();
const CACHE_MS = 60 * 1000;
function invalidarPortalHost(empresaId) {
  if (empresaId == null) cache.clear(); else cache.delete(Number(empresaId));
}

/** Dominio proprio ATIVO da empresa (so se o plano/adicional ainda inclui o recurso); senao o dominio da plataforma. */
async function portalHostDaEmpresa(empresaId, { db = require("../../db"), temRecurso = require("./assinatura").temRecurso } = {}) {
  const padrao = sistema() || null;
  if (!empresaId) return padrao;
  const hit = cache.get(Number(empresaId));
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  let v = padrao;
  try {
    const [[e]] = await db.execute("SELECT dominio_portal, dominio_status FROM empresas WHERE id = ?", [empresaId]);
    if (e && e.dominio_portal && e.dominio_status === "ativo" && (await temRecurso(Number(empresaId), "dominio"))) v = e.dominio_portal;
  } catch (err) {
    if (err.code !== "ER_BAD_FIELD_ERROR") console.error("[dominio] portalHostDaEmpresa:", err.message); // migration 046 ausente = plataforma
  }
  cache.set(Number(empresaId), { t: Date.now(), v });
  return v;
}

module.exports = { validarDominio, verificarDns, garantirSnippetSeguranca, garantirDesafioHttp, motivoCertbot, emitirCertificado, escreverVhost, removerDominio, portalHostDaEmpresa, invalidarPortalHost };
