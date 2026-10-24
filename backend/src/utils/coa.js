/**
 * CoA (Change of Authorization) para sessoes ativas no MikroTik.
 *
 * Usado no upgrade trial -> plano pago SEM reconexao (Fase 1.7): a sessao ativa
 * continua no ar, mas velocidade (Mikrotik-Rate-Limit) e tempo (Session-Timeout)
 * mudam na hora. O MikroTik aceita CoA na porta 3799 (hotspotSetup.js configura
 * /radius/incoming accept=yes port=3799).
 *
 * Implementado via `radclient` do sistema (mesmo dicionario do FreeRADIUS, entao
 * Mikrotik-Rate-Limit e' resolvido). Nunca lanca: retorna { ok, ... } sempre, pra
 * o chamador cair no fallback de reconexao quando o CoA falhar.
 */
const { execFile } = require("child_process");
const db = require("../../db");

const COA_PORT = 3799;
const COA_TIMEOUT_MS = 8000;

/**
 * Envia um pacote CoA-Request (ou Disconnect-Request) via radclient.
 * @param {Object} p
 * @param {string} p.nasip - IP do NAS (radacct.nasipaddress)
 * @param {string} p.secret - segredo RADIUS do NAS
 * @param {Object} p.attrs - atributos { 'User-Name': 'x', 'Session-Timeout': 3600, ... }
 * @param {"coa"|"disconnect"} [p.codigo="coa"] - tipo do pacote
 * @returns {Promise<{ok:boolean, stdout?:string, error?:string}>}
 */
function enviarCoA({ nasip, secret, attrs, codigo = "coa" }) {
  return new Promise((resolve) => {
    const payload = Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k} = ${typeof v === "number" ? v : `"${String(v)}"`}`)
      .join("\n");

    const child = execFile(
      "radclient",
      ["-x", `${nasip}:${COA_PORT}`, codigo, secret],
      { timeout: COA_TIMEOUT_MS },
      (err, stdout = "", stderr = "") => {
        if (err) {
          return resolve({ ok: false, error: err.message, stdout, stderr });
        }
        const ok = codigo === "disconnect" ? /Disconnect-ACK/i.test(stdout) : /CoA-ACK/i.test(stdout);
        resolve({ ok, stdout, stderr });
      }
    );

    try {
      child.stdin.write(payload + "\n");
      child.stdin.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * Faz upgrade da sessao ativa de um username via CoA (novo tempo + velocidade).
 * Localiza a sessao ativa e o secret do NAS automaticamente.
 * @param {Object} p
 * @param {string} p.username
 * @param {number|string} p.sessionTimeout - novo Session-Timeout em segundos
 * @param {string} p.rateLimit - novo Mikrotik-Rate-Limit (ex.: "5M/10M")
 * @returns {Promise<{ok:boolean, reason?:string, error?:string}>}
 */
async function upgradeSessaoCoA({ username, sessionTimeout, rateLimit }) {
  try {
    const [[sess]] = await db.query(
      `SELECT acctsessionid, nasipaddress, callingstationid, framedipaddress
         FROM radacct
        WHERE username = ? AND acctstoptime IS NULL
        ORDER BY acctstarttime DESC LIMIT 1`,
      [username]
    );
    if (!sess) return { ok: false, reason: "no_active_session" };
    if (!sess.nasipaddress) return { ok: false, reason: "no_nas_ip" };

    const [[nasRow]] = await db.query(
      "SELECT secret FROM nas WHERE nasname = ? LIMIT 1",
      [sess.nasipaddress]
    );
    const secret = nasRow?.secret;
    if (!secret) return { ok: false, reason: "no_secret" };

    return await enviarCoA({
      nasip: sess.nasipaddress,
      secret,
      attrs: {
        "User-Name": username,
        "Acct-Session-Id": sess.acctsessionid || undefined,
        "Framed-IP-Address": sess.framedipaddress || undefined,
        "Session-Timeout": Number(sessionTimeout),
        "Mikrotik-Rate-Limit": rateLimit,
      },
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Derruba uma sessao ativa via Disconnect-Request (RFC 5176) ao NAS.
 * Nao apaga credenciais nem saldo: so encerra a conexao no equipamento.
 * @param {Object} p
 * @param {string} p.username
 * @param {{acctsessionid?:string, nasipaddress:string, framedipaddress?:string}} p.sessao - linha do radacct
 * @returns {Promise<{ok:boolean, reason?:string, error?:string}>}
 */
async function desconectarSessaoCoA({ username, sessao }) {
  try {
    if (!sessao || !sessao.nasipaddress) return { ok: false, reason: "no_nas_ip" };
    const [[nasRow]] = await db.query(
      "SELECT secret FROM nas WHERE nasname = ? LIMIT 1",
      [sessao.nasipaddress]
    );
    const secret = nasRow?.secret;
    if (!secret) return { ok: false, reason: "no_secret" };
    return await enviarCoA({
      nasip: sessao.nasipaddress,
      secret,
      codigo: "disconnect",
      attrs: {
        "User-Name": username,
        "Acct-Session-Id": sessao.acctsessionid || undefined,
        "Framed-IP-Address": sessao.framedipaddress || undefined,
      },
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarCoA, upgradeSessaoCoA, desconectarSessaoCoA };
