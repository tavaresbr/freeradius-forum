/**
 * portalVendor — deteccao/normalizacao do vendor do captive portal (Fase 4B).
 *
 * Cada vendor manda nomes de parametro diferentes no redirect do portal:
 *   - MikroTik: mac, ip (o MikroTik substitui $(mac)/$(ip) no HTML)
 *   - Omada:    clientMac, apMac, ssidName, radioId, site, redirectUrl
 *   - UniFi:    id (=MAC do cliente), ap (=MAC do AP), ssid, t, url
 *
 * `detectPortalVendor(query)` olha os params presentes e devolve um contexto
 * NORMALIZADO { vendor, mac, ip, apMac, ssid, radioId, site, redirectUrl, raw }
 * pra que o restante do fluxo do portal use sempre `mac`/`ip` sem se importar
 * com o vendor. A regra de deteccao segue o plano:
 *   clientMac (+apMac) -> omada ; id (+ap) -> unifi ; senao -> mikrotik.
 *
 * Observacao: no fluxo atual o gateway ja e' conhecido pela rota
 * (/hotspot/redirect/:mikrotikId -> linha da tabela mikrotiks, com .tipo). Esta
 * deteccao por parametro e' o complemento client-side: garante que o MAC certo
 * seja extraido mesmo quando o vendor usa outro nome de campo. Quando houver o
 * `tipo` do gateway, ele tem prioridade (passar via opts.tipo).
 */

/**
 * @param {Object} query - req.query do redirect do captive portal
 * @param {Object} [opts] - { tipo } tipo do gateway (autoritativo, se conhecido)
 * @returns {{vendor:string, mac:?string, ip:?string, apMac:?string,
 *   ssid:?string, radioId:?string, site:?string, redirectUrl:?string, raw:Object}}
 */
function detectPortalVendor(query = {}, opts = {}) {
  const q = query || {};

  // Deteccao por parametro (fallback quando o tipo do gateway nao veio).
  // gatewayMac cobre a variante Gateway do Omada (roteador/wired) que nao
  // manda apMac (doc 13080/13025).
  let vendor = opts.tipo || null;
  if (!vendor) {
    if (q.login_url && (q.client_mac || q.ap_mac)) vendor = "grandstream";
    else if (q.clientMac || q.clientmac || q.gatewayMac || q.GatewayMac) vendor = "omada";
    else if (q.id && (q.ap || q.ssid)) vendor = "unifi";
    else vendor = "mikrotik";
  }

  // Intelbras usa o mesmo formato de query do GWN (TODO(hardware): confirmar no AP).
  if (vendor === "grandstream" || vendor === "intelbras") {
    return {
      vendor,
      mac: q.client_mac || q.clientMac || q.mac || null,
      ip: q.client_ip || q.clientIp || q.ip || null,
      apMac: q.ap_mac || q.apMac || null,
      ssid: q.ssid || q.ssidName || null,
      radioId: null,
      site: null,
      redirectUrl: q.redirectUrl || q.redirect || q.url || null,
      raw: q, // preserva login_url/client_mac/ap_mac pro montarGatewayInfo
    };
  }

  if (vendor === "omada") {
    return {
      vendor: "omada",
      mac: q.clientMac || q.clientmac || q.mac || null,
      // Modo External RADIUS manda clientIp; modo API nao manda IP nenhum.
      ip: q.clientIp || q.clientIP || q.clientip || q.ip || null,
      apMac: q.apMac || q.apmac || null,
      ssid: q.ssidName || q.ssidname || q.ssid || null,
      radioId: q.radioId || q.radioid || null,
      site: q.site || null,
      redirectUrl: q.redirectUrl || q.redirecturl || q.originUrl || q.originalUrl || q.url || null,
      raw: q, // preserva target/targetPort/scheme/gatewayMac/vid/clientIp etc.
        // (necessarios pro form browserauth do modo External RADIUS — doc 13025)
    };
  }

  if (vendor === "unifi") {
    return {
      vendor: "unifi",
      mac: q.id || q.mac || null,
      ip: q.ip || null,
      apMac: q.ap || null,
      ssid: q.ssid || null,
      radioId: null,
      site: null,
      redirectUrl: q.url || q.redirectUrl || null,
      raw: q,
    };
  }

  // mikrotik (default)
  return {
    vendor: "mikrotik",
    mac: q.mac || q.callingstationid || null,
    ip: q.ip || null,
    apMac: q["ap-mac"] || q.apMac || null,
    ssid: q.ssid || null,
    radioId: null,
    site: null,
    redirectUrl: q["link-orig"] || q.linkorig || q.redirectUrl || null,
    raw: q,
  };
}

module.exports = { detectPortalVendor };
