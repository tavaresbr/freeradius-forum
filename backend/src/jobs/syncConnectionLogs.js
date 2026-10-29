/**
 * Sync job: radacct -> connection_logs (compliance Marco Civil).
 *
 * Reescrito (Fase 1.2):
 *  - Cursor por datetime (acctupdatetime/acctstoptime), NAO por radacctid. Assim
 *    sessoes ABERTAS tambem entram e sao atualizadas a cada interim/stop.
 *  - Auto-reparo: cria a linha de controle em connection_logs_sync se ausente.
 *  - LEFT JOIN mikrotiks (nao INNER): sessao com NAS-IP que nao bate (NAT/VPN)
 *    nao e mais descartada silenciosamente; empresa_id cai no fallback radius_users.
 *  - CPF derivado do username (que JA e o CPF quando tem 11 digitos), com
 *    fallback no lead por MAC.
 *  - INSERT ... ON DUPLICATE KEY UPDATE por acctuniqueid (indice UNIQUE) -> idempotente.
 *
 * Uso:
 *   node src/jobs/syncConnectionLogs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../../db');
const { parseCalledStationId, aprenderAccessPoint } = require('../utils/apInfo');

const EPOCH = '1970-01-01 00:00:00';

// Cadastros (leads) sem AP/SSID: Omada/UniFi gravam no cadastro pelo contexto do portal, mas o MikroTik nao tem
// contexto; o dado so aparece no radacct depois da 1a conexao (-> connection_logs). Completa SO o que esta
// NULL (nunca sobrescreve o que o portal capturou), pela sessao mais recente do MAC. `desdeDias` limita a
// janela da varredura (null = todo o historico, usado no backfill manual).
async function completarApDosLeads(conn, desdeDias = 1) {
  const janela = desdeDias ? 'AND inicio_conexao >= DATE_SUB(NOW(), INTERVAL ? DAY)' : '';
  const params = desdeDias ? [desdeDias] : [];
  try {
    const [r] = await conn.execute(
      `UPDATE leads l
       JOIN (
         SELECT cl.empresa_id, cl.mac, cl.ap_mac, cl.ssid
         FROM connection_logs cl
         JOIN (
           SELECT empresa_id, mac, MAX(inicio_conexao) AS ini
           FROM connection_logs
           WHERE mac <> '' AND (ap_mac IS NOT NULL OR ssid IS NOT NULL) ${janela}
           GROUP BY empresa_id, mac
         ) u ON u.empresa_id = cl.empresa_id AND u.mac = cl.mac AND u.ini = cl.inicio_conexao
         WHERE cl.ap_mac IS NOT NULL OR cl.ssid IS NOT NULL
       ) c ON c.empresa_id = l.empresa_id
          AND c.mac COLLATE utf8mb4_unicode_ci = l.mac COLLATE utf8mb4_unicode_ci
       SET l.ap_mac = c.ap_mac, l.ssid = c.ssid
       WHERE l.ap_mac IS NULL AND l.ssid IS NULL AND l.mac IS NOT NULL AND l.mac <> ''`,
      params
    );
    return r?.affectedRows || 0;
  } catch (err) {
    console.warn('[syncConnectionLogs] completarApDosLeads falhou:', err.message);
    return 0;
  }
}

async function syncConnectionLogs() {
  const conn = await db.getConnection();

  try {
    // 1. Cursor (datetime). Auto-reparo: cria a linha se nao existir.
    const [syncRow] = await conn.execute(
      'SELECT id, last_synced_at FROM connection_logs_sync ORDER BY id DESC LIMIT 1'
    );
    let syncId;
    let cursor;
    if (syncRow.length === 0) {
      const [ins] = await conn.execute(
        'INSERT INTO connection_logs_sync (last_synced_radacctid, last_synced_at, synced_at) VALUES (0, NULL, NOW())'
      );
      syncId = ins.insertId;
      cursor = EPOCH;
      console.log('[syncConnectionLogs] Linha de controle ausente -> criada (auto-reparo).');
    } else {
      syncId = syncRow[0].id;
      cursor = syncRow[0].last_synced_at || EPOCH;
    }

    console.log(`[syncConnectionLogs] Cursor: ${cursor}`);

    // 2. Sessoes (abertas OU fechadas) atualizadas apos o cursor.
    //    sortKey = COALESCE(acctupdatetime, acctstoptime, acctstarttime)
    const [rows] = await conn.execute(
      `SELECT
        ra.acctuniqueid,
        ra.username,
        COALESCE(m.empresa_id, ru.empresa_id) AS empresa_id,
        ll.cpf AS lead_cpf,
        ra.callingstationid AS mac,
        ra.calledstationid,
        ra.framedipaddress AS ip_atribuido,
        ra.nasipaddress AS nas_ip,
        ra.acctstarttime AS inicio_conexao,
        ra.acctstoptime AS fim_conexao,
        ra.acctinputoctets AS bytes_entrada,
        ra.acctoutputoctets AS bytes_saida,
        ra.acctsessiontime AS duracao_segundos,
        ra.acctterminatecause AS motivo_desconexao,
        ra.acctauthentic AS auth_result,
        COALESCE(ra.acctupdatetime, ra.acctstoptime, ra.acctstarttime) AS sort_key
      FROM radacct ra
      LEFT JOIN mikrotiks m
        ON m.ip COLLATE utf8mb4_unicode_ci = ra.nasipaddress COLLATE utf8mb4_unicode_ci
      LEFT JOIN (
         SELECT username, MAX(empresa_id) AS empresa_id
         FROM radius_users
         GROUP BY username
      ) ru ON ru.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci
      LEFT JOIN (
         SELECT mac, empresa_id, MAX(cpf) AS cpf
         FROM leads
         GROUP BY mac, empresa_id
      ) ll ON ll.mac COLLATE utf8mb4_unicode_ci = ra.callingstationid COLLATE utf8mb4_unicode_ci
          AND ll.empresa_id = COALESCE(m.empresa_id, ru.empresa_id)
      WHERE COALESCE(ra.acctupdatetime, ra.acctstoptime, ra.acctstarttime) > ?
      ORDER BY sort_key ASC
      LIMIT 5000`,
      [cursor]
    );

    if (rows.length === 0) {
      console.log('[syncConnectionLogs] Nenhuma sessao nova/atualizada.');
      return { synced: 0 };
    }

    console.log(`[syncConnectionLogs] ${rows.length} sessoes para sincronizar.`);

    let maxCursor = cursor;
    let inseridas = 0;
    let ignoradas = 0;
    const apsAprendidos = new Set(); // dedupe do upsert em access_points nesta rodada

    for (const row of rows) {
      if (row.sort_key && (maxCursor === EPOCH || new Date(row.sort_key) > new Date(maxCursor))) {
        maxCursor = row.sort_key;
      }

      // empresa_id e NOT NULL: sem empresa atribuivel, nao da pra registrar. Pula
      // (o cursor ainda avanca, entao nao trava o job).
      if (!row.empresa_id) {
        ignoradas++;
        continue;
      }

      // CPF: o username JA e o CPF quando tem 11 digitos; senao fallback no lead.
      const usernameDigits = String(row.username || '').replace(/\D/g, '');
      const cpf = /^\d{11}$/.test(usernameDigits) ? usernameDigits : (row.lead_cpf || null);

      // AP de origem: Omada/UniFi mandam "MAC-DO-AP:SSID" no calledstationid;
      // MikroTik manda o nome do server hotspot (cai no campo ssid).
      const { apMac, ssid } = parseCalledStationId(row.calledstationid);

      await conn.execute(
        `INSERT INTO connection_logs
          (empresa_id, username, acctuniqueid, cpf, mac, ip_atribuido, nas_ip,
           ap_mac, ssid,
           inicio_conexao, fim_conexao, bytes_entrada, bytes_saida, duracao_segundos,
           motivo_desconexao, auth_result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
           empresa_id = VALUES(empresa_id),
           cpf = VALUES(cpf),
           mac = VALUES(mac),
           ip_atribuido = VALUES(ip_atribuido),
           nas_ip = VALUES(nas_ip),
           ap_mac = VALUES(ap_mac),
           ssid = VALUES(ssid),
           fim_conexao = VALUES(fim_conexao),
           bytes_entrada = VALUES(bytes_entrada),
           bytes_saida = VALUES(bytes_saida),
           duracao_segundos = VALUES(duracao_segundos),
           motivo_desconexao = VALUES(motivo_desconexao),
           auth_result = VALUES(auth_result)`,
        [
          row.empresa_id,
          row.username,
          row.acctuniqueid,
          cpf,
          row.mac || '',
          row.ip_atribuido || '',
          row.nas_ip || '',
          apMac,
          ssid,
          row.inicio_conexao,
          row.fim_conexao,
          row.bytes_entrada || 0,
          row.bytes_saida || 0,
          row.duracao_segundos || 0,
          row.motivo_desconexao || null,
          row.auth_result || null
        ]
      );
      inseridas++;

      // Auto-aprendizado do catalogo de APs (MAC -> nome amigavel dado pelo admin).
      const apKey = `${row.empresa_id}|${apMac}`;
      if (apMac && !apsAprendidos.has(apKey)) {
        apsAprendidos.add(apKey);
        await aprenderAccessPoint(conn, row.empresa_id, apMac, ssid);
      }
    }

    // 3. Avanca o cursor.
    await conn.execute(
      'UPDATE connection_logs_sync SET last_synced_at = ?, synced_at = NOW() WHERE id = ?',
      [maxCursor, syncId]
    );

    const leadsAtualizados = await completarApDosLeads(conn);
    if (leadsAtualizados) console.log(`[syncConnectionLogs] AP/SSID completados em ${leadsAtualizados} cadastro(s).`);

    console.log(`[syncConnectionLogs] Processadas ${inseridas}, ignoradas ${ignoradas}. Cursor -> ${maxCursor}`);
    return { synced: inseridas, ignored: ignoradas, cursor: maxCursor };
  } catch (err) {
    console.error('[syncConnectionLogs] Erro:', err);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = syncConnectionLogs;
module.exports.completarApDosLeads = completarApDosLeads;

// Run directly
if (require.main === module) {
  syncConnectionLogs()
    .then(async (result) => {
      // Rodando na mao: tambem completa AP/SSID dos cadastros antigos (todo o historico).
      const conn = await db.getConnection();
      try {
        const n = await completarApDosLeads(conn, null);
        console.log(`[syncConnectionLogs] Backfill AP/SSID: ${n} cadastro(s).`);
      } finally {
        conn.release();
      }
      console.log('[syncConnectionLogs] Concluido:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[syncConnectionLogs] Falha:', err);
      process.exit(1);
    });
}
