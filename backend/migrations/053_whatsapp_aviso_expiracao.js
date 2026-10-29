require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Aviso "seu tempo esta acabando": controle de envio (1 aviso por ciclo de liberacao). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 053: aviso de expiracao por WhatsApp ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_avisos_expiracao (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        username VARCHAR(64) NOT NULL,
        liberado_em DATETIME NOT NULL,
        enviado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_aviso_exp (empresa_id, username, liberado_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. whatsapp_avisos_expiracao ok.');
    console.log('\n=== Migration 053 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
