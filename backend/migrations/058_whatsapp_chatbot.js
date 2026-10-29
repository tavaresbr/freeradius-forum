require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Chatbot de menu do atendimento WhatsApp: estado por conversa. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 058: chatbot do atendimento ===\n');
    const [[r]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_conversas' AND COLUMN_NAME = 'chatbot_estado'"
    );
    if (Number(r.n) === 0) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN chatbot_estado VARCHAR(12) NULL, ADD COLUMN chatbot_em DATETIME NULL');
      console.log('1. whatsapp_conversas.chatbot_estado / chatbot_em criadas.');
    } else console.log('1. colunas do chatbot ja existem.');
    console.log('\n=== Migration 058 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
