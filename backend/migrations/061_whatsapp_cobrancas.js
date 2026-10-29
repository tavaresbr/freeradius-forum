require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Renovacao por WhatsApp (lembrete de compra do portal que venceu): dedupe e relatorio. Idempotente.
// UNIQUE (empresa_id, pagamento_id, etapa): 1 lembrete por compra e por "dias apos o vencimento".
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 061: renovacao por WhatsApp ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_cobrancas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        pagamento_id INT NOT NULL,
        etapa INT NOT NULL,
        telefone VARCHAR(20) NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'enviada',
        enviado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_cobranca (empresa_id, pagamento_id, etapa),
        KEY idx_wa_cobranca_tel (empresa_id, telefone, enviado_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela whatsapp_cobrancas pronta.');
    console.log('\n=== Migration 061 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
