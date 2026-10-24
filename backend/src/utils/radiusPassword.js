/**
 * radiusPassword — senha aleatoria para usuarios RADIUS do hotspot.
 *
 * Antes, Cleartext-Password == username (CPF ou MAC), ou seja, quem soubesse o
 * CPF de alguem autenticava como essa pessoa. Agora toda criacao/re-liberacao
 * grava uma senha aleatoria em radcheck e devolve ESSA senha (frontend e
 * WhatsApp {{password}}). A fonte da verdade e sempre o radcheck.
 *
 * Alfabeto sem caracteres ambiguos (0/O, 1/l/i) e sem maiusculas: o cliente pode
 * ter que digitar a senha recebida no WhatsApp. So [a-z2-9] => segura em URL.
 */
const crypto = require("crypto");

const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 simbolos
const TAMANHO_PADRAO = 8;

/**
 * Gera senha aleatoria (CSPRNG, sem vies de modulo via crypto.randomInt).
 * @param {number} [tamanho=8]
 * @returns {string}
 */
function gerarSenhaRadius(tamanho = TAMANHO_PADRAO) {
  const n = Math.max(6, Math.min(32, parseInt(tamanho, 10) || TAMANHO_PADRAO));
  let out = "";
  for (let i = 0; i < n; i++) out += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return out;
}

/**
 * Senha legada (== username) ainda gravada em radcheck?
 */
function ehSenhaLegada(username, senha) {
  return !!username && String(senha) === String(username);
}

/**
 * Le a senha REAL gravada em radcheck. Retorna null se nao existir.
 *
 * Com `pagamentoId`, so devolve se a liberacao ja terminou para aquele
 * pagamento (radius_users.liberado_em >= pagamentos.liberado_em), evitando
 * devolver a senha de um ciclo anterior enquanto outra request (webhook /
 * polling) ainda esta regravando as credenciais.
 * @param {string} username
 * @param {{pagamentoId?: number}} [opts]
 * @returns {Promise<string|null>}
 */
async function obterSenhaRadius(username, { pagamentoId } = {}) {
  if (!username) return null;
  const db = require("../../db"); // lazy: mantem o helper testavel sem pool MySQL
  let sql = "SELECT rc.value FROM radcheck rc WHERE rc.username = ? AND rc.attribute = 'Cleartext-Password'";
  const params = [username];
  if (pagamentoId) {
    sql += ` AND (
      (SELECT liberado_em FROM pagamentos WHERE id = ?) IS NULL
      OR (SELECT MAX(ru.liberado_em) FROM radius_users ru WHERE ru.username = rc.username)
         >= (SELECT liberado_em FROM pagamentos WHERE id = ?)
    )`;
    params.push(pagamentoId, pagamentoId);
  }
  sql += " LIMIT 1";
  const [rows] = await db.query(sql, params);
  return rows[0] ? String(rows[0].value) : null;
}

module.exports = { gerarSenhaRadius, ehSenhaLegada, obterSenhaRadius, ALFABETO };
