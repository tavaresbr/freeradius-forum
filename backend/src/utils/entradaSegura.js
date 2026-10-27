/**
 * Sanitizacao de entradas publicas que vao parar em HTML/JS/URL.
 * Os endpoints do captive portal (/hotspot/redirect, /api/hotspot-login) sao publicos
 * e servidos na mesma origem do painel: qualquer valor de query/path refletido sem
 * validacao vira XSS (e roubo do token do admin).
 */
const net = require("net");

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

const RE_MAC = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;
/** MAC no formato aa:bb:cc:dd:ee:ff (ou com hifen); qualquer outra coisa vira "". */
const normalizarMac = (v) => (RE_MAC.test(String(v ?? "").trim()) ? String(v).trim() : "");
/** IPv4/IPv6 valido; senao "". */
const normalizarIp = (v) => (net.isIP(String(v ?? "").trim()) ? String(v).trim() : "");
/** id numerico (id de mikrotik na URL); senao null. */
const normalizarId = (v) => (/^\d{1,10}$/.test(String(v ?? "")) ? String(v) : null);
/** slug/identificador simples: so letras, numeros, _ e -. */
const normalizarSlug = (v) => String(v ?? "").replace(/[^\w-]/g, "").slice(0, 100);
/** hostname/dominio (com porta opcional) sem caracteres perigosos. */
const normalizarHost = (v) => String(v ?? "").replace(/[^A-Za-z0-9.:\-\[\]]/g, "").slice(0, 255);

/** So http(s): devolve a URL normalizada ou null (bloqueia javascript:, data:, etc). */
function urlHttpSegura(v) {
  if (!v || typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Destino de portal: caminho relativo do proprio site ("/cadastro", nao "//host" nem "/\\host") ou http(s) absoluto. */
function urlPortalSegura(v) {
  if (!v || typeof v !== "string") return null;
  const t = v.trim();
  if (/^\/(?![\/\\])/.test(t) && !/[\x00-\x1f]/.test(t)) return t;
  return urlHttpSegura(t);
}

/** IPv4 privado/loopback/link-local (rede local do cliente, onde ficam os controllers). */
function ipPrivado(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ""));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Host de uma URL/host:porta (minusculo) ou "". */
function hostDe(v) {
  if (!v) return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(v) ? v : `http://${v}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * O destino do "login final" (POST/GET com usuario e senha no navegador do cliente) precisa
 * ser o proprio controller/gateway cadastrado ou um IP da rede local — nunca um host
 * arbitrario vindo da query do redirect (envio de credenciais a um servidor do atacante).
 */
function hostPermitidoGateway(host, gw = {}) {
  const h = hostDe(host);
  if (!h) return false;
  if (ipPrivado(h)) return true;
  return [gw.ip, gw.vpn_ip, gw.controller_url].some((c) => c && hostDe(c) === h);
}

module.exports = {
  escapeHtml, normalizarMac, normalizarIp, normalizarId, normalizarSlug, normalizarHost,
  urlHttpSegura, urlPortalSegura, ipPrivado, hostDe, hostPermitidoGateway,
};
