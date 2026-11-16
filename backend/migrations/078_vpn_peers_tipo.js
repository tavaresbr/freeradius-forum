require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// empresa_vpn_peers.tipo: tipo do equipamento escolhido ao criar o peer (mikrotik/omada/unifi/grandstream/intelbras).
// O assistente "Adicionar Equipamento" usa o tipo para ja selecionar o equipamento ao clicar no peer. Idempotente;
// peers antigos viram 'mikrotik' (o unico tipo que tinha script ate aqui).

async function colunaExiste(conn, t, c) {
  const [r] = await conn.execute('SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]);
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 078: tipo do peer da VPN ===\n');
    if (!(await colunaExiste(conn, 'empresa_vpn_peers', 'tipo'))) {
      await conn.execute("ALTER TABLE empresa_vpn_peers ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'mikrotik'");
      console.log('1. empresa_vpn_peers.tipo criada.');
    } else console.log('1. empresa_vpn_peers.tipo ok.');
    console.log('\n=== Migration 078 concluida! ===');
  } catch (err) {
    console.error('Erro na migracao:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
