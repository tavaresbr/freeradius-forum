/**
 * Login final do AP Intelbras (Zeus OS) com Captive Portal Externo + RADIUS.
 *
 * Especificacao "Intelbras Zeus OS - Captive Portal Externo v2.0":
 *   1. O AP redireciona o cliente ao nosso portal (GET) com: continue (URL original),
 *      ip (IP DO AP, nao do cliente), ap_mac, mac (do cliente), radio, ssid, ts,
 *      redirect_uri (login do AP, ex.: https://meucaptive.intelbras.com.br:2061/cp/itbcaptive.cgi)
 *      e user_hash (identifica o pedido).
 *   2. Depois do cadastro o NAVEGADOR volta ao redirect_uri (GET ou POST) com
 *      continue, username, password e user_hash. O AP valida usuario/senha no
 *      nosso FreeRADIUS e redireciona ao `continue`.
 *
 * Este modulo e' puro (sem banco) para ser testavel. O destino recebe usuario e
 * senha, e vem da query publica do redirect: so vale se for o proprio AP.
 */
const { urlHttpSegura, hostPermitidoGateway } = require("../utils/entradaSegura");

const HOST_CAPTIVE_INTELBRAS = "meucaptive.intelbras.com.br";
const CAMINHO_LOGIN = "/cp/itbcaptive.cgi";
const PORTA_LOGIN = "2061";
const FALLBACK_CONTINUE = "http://neverssl.com";

/**
 * URL de login do AP (redirect_uri) ou null. So aceita o caminho/porta do AP e um
 * destino que seja o dominio oficial da Intelbras, o IP cadastrado do gateway ou
 * um IP da rede local — senao a senha RADIUS iria para um host do atacante.
 */
function loginUrlIntelbras(raw, gw = {}) {
  const u = urlHttpSegura(raw?.redirect_uri || "");
  if (!u) return null;
  const url = new URL(u);
  if (url.username || url.password) return null;
  if (url.pathname !== CAMINHO_LOGIN || url.port !== PORTA_LOGIN) return null;
  const host = url.hostname.toLowerCase();
  if (host !== HOST_CAPTIVE_INTELBRAS && !hostPermitidoGateway(host, gw)) return null;
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** `continue` chega sem esquema ("neverssl.com/"): completa com http:// e valida. */
function continuarUrl(valor) {
  const v = String(valor || "").trim();
  if (!v) return FALLBACK_CONTINUE;
  const comEsquema = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  return urlHttpSegura(comEsquema) || FALLBACK_CONTINUE;
}

/**
 * Dados que o frontend precisa para devolver o cliente ao AP, ou null se o
 * contexto do redirect nao tem o necessario (cliente nunca passou pelo AP).
 * @param {Object} ctx - contexto salvo no redirect (detectPortalVendor, com .raw)
 */
function montarLoginIntelbras(ctx, gw = {}) {
  const raw = ctx?.raw || {};
  const url = loginUrlIntelbras(raw, gw);
  const userHash = String(raw.user_hash || "");
  if (!url || !/^[A-Za-z0-9]{1,128}$/.test(userHash)) return null;
  return { url, user_hash: userHash, continue: continuarUrl(raw.continue) };
}

module.exports = { loginUrlIntelbras, continuarUrl, montarLoginIntelbras, HOST_CAPTIVE_INTELBRAS };
