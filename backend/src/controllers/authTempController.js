const db = require("../../db");
const { gerarSenhaRadius } = require("../utils/radiusPassword");

function gerarUsernameAleatorio(empresaId) {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 6);
  return `pix_e${empresaId || 0}_${timestamp}_${random}`;
}

async function gerarAcessoTemporario(mac, ip, planoId, empresaId, opts = {}) {
  try {
    // opts.username: username explicito (ex.: CPF) -> cria ja o usuario definitivo,
    // permitindo upgrade sem reconexao via CoA quando o pagamento for aprovado (1.7).
    const usernameExplicito = opts.username || null;
    const username = usernameExplicito
      ? usernameExplicito
      : (opts.usernamePrefix
          ? `${opts.usernamePrefix}_${Date.now().toString().slice(-6)}_${Math.random().toString(36).substring(2, 6)}`
          : gerarUsernameAleatorio(empresaId));
    const senha = gerarSenhaRadius(); // aleatoria (nao mais == username)
    const rateLimit = opts.rateLimit || "2M/2M";
    const tempoSegundos = opts.duracaoSegundos || 300;

    // Se username explicito (CPF), limpa entradas antigas pra recriar limpo com
    // os limites do trial (o usuario pode ja existir de um acesso anterior).
    if (usernameExplicito) {
      await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
      await db.query("DELETE FROM radreply WHERE username = ?", [username]);
      await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);
    }

    // Limpa APENAS registros pix antigos DESTA empresa (expirados > 10 min)
    const prefixo = `pix_e${empresaId || 0}_%`;
    const [antigos] = await db.query(
      `SELECT DISTINCT rc.username FROM radcheck rc
       WHERE rc.username LIKE ? AND rc.username NOT IN (
         SELECT username FROM radacct WHERE acctstoptime IS NULL
       )`,
      [prefixo]
    );
    for (const { username: oldUser } of antigos) {
      await db.query("DELETE FROM radcheck WHERE username = ?", [oldUser]);
      await db.query("DELETE FROM radreply WHERE username = ?", [oldUser]);
      await db.query("DELETE FROM radusergroup WHERE username = ?", [oldUser]);
    }

    // Insere novo usuário no RADIUS. Max-All-Session faz o totalcounter cumulativo
    // enforcar o tempo do trial (com liberado_em zerando o contador na criacao).
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES
       (?, 'Cleartext-Password', ':=', ?),
       (?, 'Max-All-Session', ':=', ?),
       (?, 'Simultaneous-Use', ':=', '1')`,
      [username, senha, username, String(tempoSegundos), username]
    );

    // WISPr-Bandwidth-Max-*: cap em bps pra vendors nao-MikroTik (Omada/UniFi
    // honram no Access-Accept); o MikroTik ignora e usa o Mikrotik-Rate-Limit.
    const [wUpM, wDownM] = String(rateLimit).split("/").map((v) => parseFloat(v) || 0);
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value) VALUES
        (?, 'Mikrotik-Rate-Limit', ':=', ?),
        (?, 'Session-Timeout', ':=', ?),
        (?, 'WISPr-Bandwidth-Max-Up', ':=', ?),
        (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [username, rateLimit, username, String(tempoSegundos),
       username, String(Math.round(wUpM * 1000000)), username, String(Math.round(wDownM * 1000000))]
    );

    // Busca o Mikrotik vinculado ao plano (filtrando por empresa)
    let planoQuery = "SELECT mikrotik_id, empresa_id FROM planos WHERE id = ?";
    const planoParams = [planoId];
    if (empresaId) {
      planoQuery += " AND empresa_id = ?";
      planoParams.push(empresaId);
    }
    planoQuery += " LIMIT 1";

    const [planos] = await db.query(planoQuery, planoParams);
    const mikrotikId = planos[0]?.mikrotik_id;

    const [mtk] = await db.query(
      "SELECT end_hotspot FROM mikrotiks WHERE id = ? LIMIT 1",
      [mikrotikId]
    );

    const gateway = mtk[0]?.end_hotspot || "192.168.0.1";

    // Registrar em radius_users para visibilidade. liberado_em = NOW() faz o
    // totalcounter comecar do zero para este trial (ignora historico anterior do CPF).
    if (empresaId && mikrotikId) {
      await db.query(`
        INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), liberado_em = NOW()
      `, [empresaId, username, planoId, mikrotikId]);
    }

    return { username, password: senha, gateway };
  } catch (err) {
    console.error("Erro ao gerar acesso temporario:", err);
    throw err;
  }
}

module.exports = {
  gerarAcessoTemporario,
};
