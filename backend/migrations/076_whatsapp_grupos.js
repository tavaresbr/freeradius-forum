require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Grupos do WhatsApp: guarda de qual grupo (e de qual numero) cada cliente foi importado. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 076: origem de clientes importados de grupos do WhatsApp ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS leads_origem_grupo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        lead_id INT NOT NULL,
        numero_id INT NOT NULL DEFAULT 0,
        grupo_jid VARCHAR(80) NOT NULL,
        grupo_nome VARCHAR(150) NOT NULL,
        importado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_lead_grupo (empresa_id, lead_id, grupo_jid),
        KEY idx_grupo_empresa (empresa_id, numero_id, grupo_jid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('1. tabela leads_origem_grupo pronta.');
    console.log('\nMigration 076 concluida.');
  } finally {
    conn.release();
    process.exit(0);
  }
}
migrate().catch((e) => { console.error(e); process.exit(1); });
