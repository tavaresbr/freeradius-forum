require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Pos-compra e avaliacoes por WhatsApp: dedupe dos envios (1 por etapa+referencia). Idempotente.
// etapa 'agradecimento' -> referencia_id = pagamentos.id; 'avaliacao'/'alerta' -> whatsapp_mensagens.id da nota.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 059: pos-compra e avaliacoes ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_pos_compra (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        etapa VARCHAR(20) NOT NULL,
        referencia_id BIGINT NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_pos_compra (empresa_id, etapa, referencia_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela whatsapp_pos_compra pronta.');
    console.log('\n=== Migration 059 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
