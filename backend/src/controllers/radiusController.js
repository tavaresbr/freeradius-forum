// backend/src/controllers/radiusController.js
const db = require('../../db');

// Cria um novo usuário no FreeRADIUS com isolamento por empresa
async function criarUsuarioRadius(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password são obrigatórios' });
  }

  try {
    // Verificar se já existe username em outra empresa
    const [[existente]] = await db.query(
      'SELECT ru.empresa_id FROM radius_users ru WHERE ru.username = ?',
      [username]
    );
    if (existente && existente.empresa_id !== req.empresa_id) {
      return res.status(400).json({ error: 'Username já em uso por outra empresa' });
    }

    // Limpa entradas antigas do mesmo username
    await db.query('DELETE FROM radcheck WHERE username = ?', [username]);

    await db.query(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, "Cleartext-Password", ":=", ?)',
      [username, password]
    );

    // Registrar na radius_users com empresa_id
    await db.query(`
      INSERT INTO radius_users (empresa_id, username, liberado_em)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE empresa_id = VALUES(empresa_id), liberado_em = COALESCE(liberado_em, NOW())
    `, [req.empresa_id, username]);

    res.status(201).json({ message: 'Usuário RADIUS criado com sucesso.' });
  } catch (error) {
    console.error('Erro ao criar usuário RADIUS:', error);
    res.status(500).json({ error: 'Erro ao criar usuário RADIUS.' });
  }
}

const vincularPlano = async (req, res) => {
  const { username, planoId } = req.body;

  try {
    // Verificar se o username pertence a esta empresa
    const [[ru]] = await db.query(
      'SELECT id FROM radius_users WHERE username = ? AND empresa_id = ?',
      [username, req.empresa_id]
    );
    if (!ru) {
      return res.status(404).json({ error: 'Usuário não encontrado nesta empresa' });
    }

    const [[plano]] = await db.query(
      'SELECT id, nome, velocidade_down, velocidade_up, duracao_minutos, mikrotik_id, shared_users FROM planos WHERE id = ? AND empresa_id = ?',
      [planoId, req.empresa_id]
    );
    if (!plano) return res.status(404).json({ error: 'Plano não encontrado' });

    const tempoSegundos = plano.duracao_minutos * 60;

    // Apaga check antigos (exceto password)
    await db.query('DELETE FROM radcheck WHERE username = ? AND attribute != "Cleartext-Password"', [username]);
    // Apaga replies antigos
    await db.query('DELETE FROM radreply WHERE username = ?', [username]);
    // Apaga grupos antigos
    await db.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    // Reseta o contador total via timestamp (sqlcounter soma radacct com
    // acctstarttime >= liberado_em). Historico do radacct preservado (Marco Civil).
    await db.query('UPDATE radius_users SET liberado_em = NOW() WHERE username = ?', [username]);

    // Limite TOTAL acumulado + 1 sessao unica
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES
       (?, 'Max-All-Session', ':=', ?),
       (?, 'Simultaneous-Use', ':=', '1')`,
      [username, String(tempoSegundos), username]
    );

    // Adiciona replies para banda e tempo
    // WISPr-Bandwidth-Max-*: cap em bps pra vendors nao-MikroTik (Omada/UniFi
    // honram no Access-Accept); o MikroTik ignora e usa o Mikrotik-Rate-Limit.
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value) VALUES
       (?, 'Mikrotik-Rate-Limit', ':=', ?),
       (?, 'Session-Timeout', ':=', ?),
       (?, 'WISPr-Bandwidth-Max-Up', ':=', ?),
       (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [
        username,
        `${plano.velocidade_up}M/${plano.velocidade_down}M`,
        username,
        String(tempoSegundos),
        username,
        String(Math.round((parseFloat(plano.velocidade_up) || 0) * 1000000)),
        username,
        String(Math.round((parseFloat(plano.velocidade_down) || 0) * 1000000))
      ]
    );

    // Define grupo
    await db.query(
      'INSERT INTO radusergroup (username, groupname) VALUES (?, ?)',
      [username, String(plano.id)]
    );

    // Atualiza vínculo em radius_users
    await db.query(`
      UPDATE radius_users SET plano_id = ?, nas_id = ? WHERE username = ? AND empresa_id = ?
    `, [plano.id, plano.mikrotik_id, username, req.empresa_id]);

    res.status(200).json({ message: 'Plano vinculado ao usuário com sucesso.' });
  } catch (error) {
    console.error('Erro ao vincular plano:', error);
    res.status(500).json({ error: 'Erro ao vincular plano ao usuário.' });
  }
};

const listarUsuarios = async (req, res) => {
  try {
    const [usuarios] = await db.query(`
      SELECT
        rc.username,
        rc.value AS senha,
        p.nome AS plano,
        p.duracao_minutos,
        p.velocidade_down,
        p.velocidade_up,
        p.shared_users,
        m.nome AS nas,
        ru.criado_em
      FROM radcheck rc
      INNER JOIN radius_users ru ON ru.username = rc.username
      LEFT JOIN planos p ON p.id = ru.plano_id
      LEFT JOIN mikrotiks m ON m.id = ru.nas_id
      WHERE rc.attribute = 'Cleartext-Password'
        AND ru.empresa_id = ?
      ORDER BY ru.criado_em DESC
    `, [req.empresa_id]);

    res.json(usuarios);
  } catch (error) {
    console.error('Erro ao listar usuários RADIUS:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
};

async function deletarUsuarioRadius(req, res) {
  const { username } = req.params;

  try {
    const [[ru]] = await db.query(
      'SELECT id FROM radius_users WHERE username = ? AND empresa_id = ?',
      [username, req.empresa_id]
    );
    if (!ru) return res.status(404).json({ error: 'Usuário não encontrado nesta empresa' });

    await db.query('DELETE FROM radcheck WHERE username = ?', [username]);
    await db.query('DELETE FROM radreply WHERE username = ?', [username]);
    await db.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    await db.query('DELETE FROM radpostauth WHERE username = ?', [username]);
    await db.query('DELETE FROM radius_users WHERE username = ? AND empresa_id = ?', [username, req.empresa_id]);

    res.status(200).json({ message: 'Usuário RADIUS deletado com sucesso.' });
  } catch (error) {
    console.error('Erro ao deletar usuário RADIUS:', error);
    res.status(500).json({ error: 'Erro ao deletar usuário RADIUS.' });
  }
}

const listarSessoesAtivas = async (req, res) => {
  try {
    const [sessoes] = await db.query(`
      SELECT
        ra.username,
        ll.cpf,
        ra.callingstationid AS mac,
        ra.framedipaddress AS ip,
        ra.nasipaddress AS gateway,
        ra.acctstarttime,
        ra.acctsessiontime AS segundos,
        ra.acctinputoctets AS bytes_entrada,
        ra.acctoutputoctets AS bytes_saida,
        -- Tempo que falta para encerrar: Max-All-Session menos o usado desde a ultima liberacao
        -- (mesma conta do sqlcounter 'totalcounter'). NULL = sem limite gravado.
        (SELECT GREATEST(CAST(rc.value AS SIGNED) - (
            SELECT COALESCE(SUM(IF(r2.acctstoptime IS NULL,
                     UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r2.acctstarttime), r2.acctsessiontime)), 0)
              FROM radacct r2
             WHERE r2.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci
               AND r2.acctstarttime >= COALESCE(
                     (SELECT MAX(ru2.liberado_em) FROM radius_users ru2
                       WHERE ru2.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci),
                     '1970-01-01 00:00:00')
          ), 0)
           FROM radcheck rc
          WHERE rc.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci
            AND rc.attribute = 'Max-All-Session'
          LIMIT 1) AS restante_segundos
      FROM radacct ra
      -- Resolucao vendor-neutra da empresa: MikroTik casa pelo IP do NAS
      -- (nasipaddress = mikrotiks.ip); Omada/UniFi reportam o IP LAN do
      -- controller no NAS-IP-Address, entao caimos pro dono do username em
      -- radius_users (username e' UNIQUE la).
      LEFT JOIN mikrotiks m ON m.ip COLLATE utf8mb4_unicode_ci = ra.nasipaddress COLLATE utf8mb4_unicode_ci
      LEFT JOIN radius_users ru ON ru.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci
      LEFT JOIN (
         SELECT mac, empresa_id, MAX(cpf) as cpf
         FROM leads
         GROUP BY mac, empresa_id
      ) ll ON ll.mac COLLATE utf8mb4_unicode_ci = ra.callingstationid COLLATE utf8mb4_unicode_ci AND ll.empresa_id = COALESCE(m.empresa_id, ru.empresa_id)
      WHERE ra.acctstoptime IS NULL
        AND COALESCE(m.empresa_id, ru.empresa_id) = ?
      ORDER BY ra.acctstarttime DESC
    `, [req.empresa_id]);

    res.json(sessoes);
  } catch (error) {
    console.error("Erro ao buscar sessões ativas:", error);
    res.status(500).json({ error: "Erro ao buscar sessões ativas" });
  }
};

module.exports = {
  criarUsuarioRadius,
  vincularPlano,
  listarUsuarios,
  deletarUsuarioRadius,
  listarSessoesAtivas
};
