require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Modelos de mensagem do hub WhatsApp: categoria nas respostas rapidas. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 062: modelos de mensagem (categoria) ===\n');
    const [[r]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_respostas_rapidas' AND COLUMN_NAME = 'categoria'"
    );
    if (Number(r.n) === 0) {
      await conn.execute("ALTER TABLE whatsapp_respostas_rapidas ADD COLUMN categoria VARCHAR(20) NOT NULL DEFAULT 'geral'");
      console.log('1. whatsapp_respostas_rapidas.categoria criada.');
    } else console.log('1. coluna categoria ja existe.');
    console.log('\n=== Migration 062 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
