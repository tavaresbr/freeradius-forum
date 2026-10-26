/**
 * gatewayLiberacao — cola entre a liberacao RADIUS e a camada de drivers.
 *
 * ===========================================================================
 * POR QUE EXISTE
 * ===========================================================================
 * Os controllers de liberacao (pagamento, LGPD, lead, login) provisionam o
 * RADIUS e devolvem { gateway, username, password } pro frontend fazer o
 * "login final". Esse passo final varia por vendor:
 *
 *   - MikroTik: GET http://{end_hotspot}/login?username&password (fluxo atual)
 *   - Omada External RADIUS: o NAVEGADOR do cliente faz form-POST em
 *       {scheme}://{target}:{targetPort}/portal/radius/browserauth
 *     com clientMac/apMac/ssidName/... + username/password (doc TP-Link 13025,
 *     controller 5.3.1+). O controller valida no FreeRADIUS.
 *   - Omada modo API: o BACKEND chama extPortal/auth (OmadaDriver).
 *   - UniFi: o BACKEND chama authorize-guest (UnifiDriver).
 *
 * Os parametros que esses passos exigem (apMac, ssidName, radioId, site,
 * target/targetPort, redirectUrl...) chegam SO no redirect do captive portal
 * (/hotspot/redirect/:id) — minutos antes da liberacao. Por isso este modulo:
 *
 *   1. salvarContextoPortal(): persiste o contexto por (mikrotik_id, mac) na
 *      tabela portal_contexts (migration 022) no momento do redirect.
 *   2. montarGatewayInfo(): na liberacao, resolve o gateway, recupera o
 *      contexto, executa o authorize server-side quando e' papel do backend
 *      (UniFi / Omada-API) e devolve o `gateway_info` que o frontend usa pra
 *      fazer o branch por vendor (frontend/src/utils/hotspotRedirect.js).
 *
 * REGRA: montarGatewayInfo NUNCA lanca — falha de API vira { ok:false, erro }
 * no gateway_info (o cliente ja esta liberado no RADIUS; o erro e' exibivel).
 * Para gateway MikroTik retorna { tipo:'mikrotik' } sem tocar em nada — o
 * comportamento legado fica 100% intacto.
 * ===========================================================================
 */
const db = require("../../db");
const { getDriver } = require("./index");
const { urlHttpSegura, hostPermitidoGateway } = require("../utils/entradaSegura");

const CONTEXTO_TTL_HORAS = 48;

/**
 * Normaliza MAC pra chave de lookup: minusculo, separador ':'.
 * Usado SOMENTE nas chaves de portal_contexts — nao muda o formato gravado
 * em radcheck/leads (o formato cru do vendor continua sendo o canonico la).
 * @param {string} mac
 * @returns {string|null}
 */
function normalizeMac(mac) {
  if (!mac) return null;
  const hex = String(mac).replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12) return String(mac).trim().toLowerCase();
  return hex.match(/.{2}/g).join(":");
}

/**
 * Persiste o contexto do redirect (upsert por mikrotik_id + mac normalizado).
 * Chamado pelo /hotspot/redirect quando o gateway nao e' MikroTik. Nao lanca.
 * @param {Object} portalCtx - retorno do detectPortalVendor (com .raw)
 * @param {Object} p - { mikrotikId, empresaId }
 */
async function salvarContextoPortal(portalCtx, { mikrotikId, empresaId }) {
  try {
    const macKey = normalizeMac(portalCtx?.mac);
    if (!macKey || !mikrotikId) return;

    await db.query(
      `INSERT INTO portal_contexts (mikrotik_id, empresa_id, mac, vendor, contexto)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE empresa_id = VALUES(empresa_id), vendor = VALUES(vendor),
         contexto = VALUES(contexto), atualizado_em = NOW()`,
      [mikrotikId, empresaId || null, macKey, portalCtx.vendor || "mikrotik", JSON.stringify(portalCtx)]
    );

    // Poda oportunista de contextos velhos (barato; tabela pequena por natureza)
    await db.query(
      "DELETE FROM portal_contexts WHERE atualizado_em < DATE_SUB(NOW(), INTERVAL ? HOUR)",
      [CONTEXTO_TTL_HORAS]
    );
  } catch (err) {
    console.warn("[gatewayLiberacao] salvarContextoPortal falhou:", err.message);
  }
}

/**
 * Recupera o contexto salvo no redirect. Tenta (mikrotik_id, mac); se nao
 * achar, cai pra busca so por mac (mais recente) — cobre o caso do plano
 * apontar pra outro registro de gateway da mesma rede.
 * @returns {Promise<Object|null>} portalCtx (JSON parseado) ou null
 */
async function carregarContextoPortal(mikrotikId, mac) {
  const macKey = normalizeMac(mac);
  if (!macKey) return null;
  try {
    let [[row]] = await db.query(
      "SELECT contexto FROM portal_contexts WHERE mikrotik_id = ? AND mac = ? LIMIT 1",
      [mikrotikId || 0, macKey]
    );
    if (!row) {
      [[row]] = await db.query(
        "SELECT contexto FROM portal_contexts WHERE mac = ? ORDER BY atualizado_em DESC LIMIT 1",
        [macKey]
      );
    }
    if (!row?.contexto) return null;
    return typeof row.contexto === "string" ? JSON.parse(row.contexto) : row.contexto;
  } catch (err) {
    console.warn("[gatewayLiberacao] carregarContextoPortal falhou:", err.message);
    return null;
  }
}

/**
 * Monta o form-POST do Omada External RADIUS (browserauth) a partir do
 * contexto do redirect. O NAVEGADOR do cliente submete este form — o backend
 * nao alcanca o controller (que pode estar numa rede local do cliente).
 * Doc: support.omadanetworks.com/us/document/13025 (controller 5.3.1+).
 * @param {Object} ctx - portalCtx salvo no redirect (usa .raw do vendor)
 * @returns {{url:string, fields:Object}|null}
 */
function montarBrowserauthOmada(ctx, gw = {}) {
  const raw = ctx?.raw || {};
  const target = raw.target || raw.Target || null;
  if (!target) return null; // sem target nao ha como montar o POST
  // O form leva usuario/senha: o destino vem da query publica do redirect, entao so vale se for
  // o controller cadastrado ou um IP da rede local (senao enviaria a credencial a um host do atacante).
  if (!/^[A-Za-z0-9.\-]+$/.test(String(target)) || !hostPermitidoGateway(target, gw)) {
    console.warn("[gatewayLiberacao] target do Omada fora do gateway cadastrado, ignorado");
    return null;
  }

  const scheme = raw.scheme === "https" ? "https" : "http";
  const portaOk = (p) => (/^\d{2,5}$/.test(String(p || "")) ? String(p) : null);
  const targetPort = portaOk(raw.targetPort || raw.targetport) || (scheme === "https" ? "8043" : "8088");

  const fields = {
    clientMac: raw.clientMac || raw.clientmac || ctx.mac || "",
    clientIp: raw.clientIp || raw.clientIP || raw.clientip || ctx.ip || "",
    apMac: raw.apMac || raw.apmac || "",
    gatewayMac: raw.gatewayMac || raw.GatewayMac || raw.gatewaymac || "",
    ssidName: raw.ssidName || raw.ssidname || ctx.ssid || "",
    radioId: raw.radioId || raw.radioid || "",
    vid: raw.vid || "",
    authType: 2, // 2 = RADIUS (doc 13025)
    originUrl: urlHttpSegura(raw.originUrl || raw.originalUrl || raw.redirectUrl || ctx.redirectUrl || "") || "",
  };
  // Campos vazios sao removidos (wired nao tem apMac; wireless nao tem vid)
  Object.keys(fields).forEach((k) => {
    if (fields[k] === "" || fields[k] === null || fields[k] === undefined) delete fields[k];
  });

  // Cert self-signed do controller bloqueia o POST https no webview do captive
  // portal (sem UI pra aceitar cert invalido). O redirect do Omada informa a
  // porta HTTP do portal em serverPort (8088) — preferimos http nela; fallback
  // pro scheme/targetPort originais quando serverPort nao vier.
  const serverPort = portaOk(raw.serverPort || raw.serverport);
  const url = serverPort
    ? `http://${target}:${serverPort}/portal/radius/browserauth`
    : `${scheme}://${target}:${targetPort}/portal/radius/browserauth`;
  return { url, fields };
}

/**
 * Saldo restante (segundos) do username. Suporta plano de tempo CORRIDO
 * (atributo Expiration, corte pelo relogio) e CUMULATIVO (Max-All-Session menos
 * consumo desde liberado_em, contando sessoes abertas). Mesma logica do
 * UnifiDriver._saldoMinutos, compartilhada aqui pra os vendores autorizarem
 * pelo tempo certo em reconexoes.
 * @returns {Promise<number|null>} segundos restantes; 0 = esgotado; null = nao
 *   apuravel (sem Max-All-Session/Expiration no radcheck)
 */
async function saldoSegundos(username) {
  if (!username) return 0;
  try {
    // Planos de tempo CORRIDO gravam 'Expiration'; CUMULATIVOS gravam
    // 'Max-All-Session'. Sem nenhum dos dois => null (saldo nao apuravel,
    // diferente de 0 = esgotado).
    const [chks] = await db.query(
      "SELECT attribute, value FROM radcheck WHERE username = ? AND attribute IN ('Max-All-Session', 'Expiration')",
      [username]
    );
    if (chks.length === 0) return null;

    const expAttr = chks.find((c) => c.attribute === "Expiration");
    if (expAttr && expAttr.value) {
      const expireTime = Date.parse(expAttr.value);
      if (isNaN(expireTime)) return 0;
      return Math.max(0, Math.floor((expireTime - Date.now()) / 1000));
    }

    const maxAttr = chks.find((c) => c.attribute === "Max-All-Session");
    const maxSeg = maxAttr ? Number(maxAttr.value) : 0;
    if (!maxSeg) return null;

    const [[lib]] = await db.query(
      "SELECT liberado_em FROM radius_users WHERE username = ? ORDER BY liberado_em DESC LIMIT 1",
      [username]
    );
    const liberadoEm = lib?.liberado_em || null;

    // Consumo desde a ultima liberacao, contando sessoes AINDA ABERTAS
    // (fim_conexao IS NULL -> conta ate agora). Recorta por liberado_em pra
    // nao somar ciclos anteriores.
    const [[cons]] = await db.query(
      `SELECT COALESCE(SUM(
           GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(inicio_conexao, COALESCE(?, '1970-01-01')), IFNULL(fim_conexao, NOW())))
         ), 0) AS usado
         FROM connection_logs
        WHERE username = ? AND (fim_conexao IS NULL OR fim_conexao >= COALESCE(?, '1970-01-01'))`,
      [liberadoEm, username, liberadoEm]
    );
    return Math.max(0, maxSeg - Number(cons?.usado || 0));
  } catch (err) {
    console.warn("[gatewayLiberacao] saldoSegundos falhou:", err.message);
    return 0;
  }
}

/**
 * Monta o gateway_info da resposta de liberacao e executa o authorize
 * server-side quando o papel e' do backend (UniFi / Omada modo API).
 *
 * @param {Object} p
 * @param {number} p.mikrotik_id - id do gateway (linha de `mikrotiks`)
 * @param {number} [p.empresa_id]
 * @param {string} p.mac - MAC do cliente (formato cru do vendor)
 * @param {string} p.username - username RADIUS ja provisionado
 * @param {number} [p.duracaoSegundos] - fallback de duracao quando o saldo
 *   ainda nao e' apuravel (ex.: trial recem-criado)
 * @returns {Promise<Object>} gateway_info (nunca lanca)
 */
async function montarGatewayInfo({ mikrotik_id, empresa_id, mac, username, duracaoSegundos }) {
  try {
    if (!mikrotik_id) return { tipo: "mikrotik" };

    const [[gw]] = await db.query("SELECT * FROM mikrotiks WHERE id = ? LIMIT 1", [mikrotik_id]);
    if (!gw || !gw.tipo || gw.tipo === "mikrotik") {
      return { tipo: "mikrotik" };
    }

    const ctx = await carregarContextoPortal(mikrotik_id, mac);
    const redirectUrl = urlHttpSegura(ctx?.redirectUrl || ctx?.raw?.redirectUrl || ctx?.raw?.originUrl || "") || null;

    if (gw.tipo === "grandstream") {
      // External Web Portal + External RADIUS: o RADIUS ja foi provisionado por
      // liberarUsuario; o "login final" e' um GET no login_url do gateway GWN
      // (o navegador do cliente faz o redirect — hotspotRedirect.js).
      const saldo = await saldoSegundos(username);
      if (saldo === 0 && !duracaoSegundos) {
        return {
          tipo: "grandstream",
          ok: false,
          erro: "Seu plano expirou ou seu limite de tempo foi atingido.",
          redirect_url: redirectUrl,
        };
      }
      return {
        tipo: "grandstream",
        ok: true,
        gwn_login_url: (() => {
          const u = urlHttpSegura(ctx?.raw?.login_url || ctx?.raw?.loginUrl || "");
          return u && hostPermitidoGateway(u, gw) ? u : null;
        })(),
        client_mac: ctx?.raw?.client_mac || ctx?.raw?.clientMac || ctx?.mac || mac,
        ap_mac: ctx?.apMac || ctx?.raw?.ap_mac || null,
        redirect_url: redirectUrl || "http://neverssl.com",
      };
    }

    if (gw.tipo === "omada") {
      // SEMPRE External RADIUS (decisao 21/08/2026): quem autoriza e' o
      // navegador do cliente via browserauth no controller — o backend so
      // monta o form. controller_url preenchido NAO muda este fluxo (a API
      // do controller e' so' captura de dados — services/omadaApNames).
      const browserauth = ctx ? montarBrowserauthOmada(ctx, gw) : null;
      return {
        tipo: "omada",
        modo: "external-radius",
        ok: !!browserauth,
        browserauth,
        redirect_url: redirectUrl,
        erro: browserauth ? undefined
          : "Contexto do portal Omada nao encontrado (redirect sem target). Reconecte ao Wi-Fi.",
      };
    }

    if (gw.tipo === "unifi") {
      const seg = (await saldoSegundos(username)) || Number(duracaoSegundos) || 0;
      const minutes = Math.max(1, Math.round(seg / 60));
      try {
        const r = await getDriver(gw).authorizeApiOnly({ mac, username, minutes });
        return { tipo: "unifi", ok: true, redirect_url: redirectUrl, unifi: r };
      } catch (err) {
        console.error("[gatewayLiberacao] UniFi authorize-guest falhou:", err.message);
        return { tipo: "unifi", ok: false, erro: err.message, redirect_url: redirectUrl };
      }
    }

    return { tipo: gw.tipo, ok: false, erro: `Gateway tipo '${gw.tipo}' sem fluxo de liberacao` };
  } catch (err) {
    console.error("[gatewayLiberacao] montarGatewayInfo falhou:", err.message);
    // Nunca bloquear a liberacao por causa do gateway_info
    return { tipo: "mikrotik" };
  }
}

module.exports = {
  normalizeMac,
  salvarContextoPortal,
  carregarContextoPortal,
  montarGatewayInfo,
  montarBrowserauthOmada,
  saldoSegundos,
};
