require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Aviso ao proprietario de cliente esperando no chat: marca por conversa de quando a espera atual ja foi avisada. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 079: aviso de cliente esperando no chat ===\n');
    const [[r]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_conversas' AND COLUMN_NAME = 'espera_avisada_em'"
    );
    if (Number(r.n) === 0) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN espera_avisada_em DATETIME NULL');
      console.log('1. whatsapp_conversas.espera_avisada_em criada.');
    } else console.log('1. coluna espera_avisada_em ja existe.');
    console.log('\n=== Migration 079 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
