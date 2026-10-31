const { RouterOSAPI } = require("node-routeros");

// Os erros do node-routeros (e do socket) muitas vezes chegam com `message` vazio; o motivo fica em
// `errno` (ex.: SOCKTMOUT, CANTLOGIN) ou `code` (ex.: ECONNREFUSED). Traduz para algo que o admin entende.
function descreverErro(e) {
  const chave = String((e && (e.code || e.errno)) || "").toUpperCase();
  const msg = String((e && e.message) || "").trim();
  const texto = `${chave} ${msg}`.toUpperCase();
  if (/CANTLOGIN|INVALID USER|BAD LOGIN|CANNOT LOG IN/.test(texto)) return "Usuário ou senha recusados pelo roteador";
  if (/SOCKTMOUT|ETIMEDOUT|TIMEOUT|TIMED OUT/.test(texto)) return "Sem resposta do roteador (confira VPN, IP e porta 8728)";
  if (/ECONNREFUSED/.test(texto)) return "Conexão recusada (API desligada ou porta errada)";
  if (/EHOSTUNREACH|ENETUNREACH/.test(texto)) return "Sem rota até o roteador (VPN fora?)";
  if (/ENOTFOUND|EAI_AGAIN/.test(texto)) return "Endereço do roteador não encontrado";
  if (/ECONNRESET|EPIPE/.test(texto)) return "Conexão encerrada pelo roteador";
  return msg || chave || "Falha ao conectar (sem detalhe do roteador)";
}

async function testarConexao({ ip, usuario, senha, porta }) {
  const conn = new RouterOSAPI({
    host: ip,
    user: usuario,
    password: senha,
    port: porta || 8728,
    timeout: 8,
  });

  try {
    await conn.connect();
    await conn.close();
    return { sucesso: true };
  } catch (error) {
    try { conn.close(); } catch { /* ja fechada */ }
    return { sucesso: false, erro: descreverErro(error) };
  }
}

module.exports = { testarConexao, descreverErro };
