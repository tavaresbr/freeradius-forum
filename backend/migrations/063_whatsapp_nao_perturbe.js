require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Nao perturbe (WhatsApp): lista central de telefones que nao recebem mensagens proativas, para quem
// nao e' lead (leads.whatsapp_optout continua valendo). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 063: nao perturbe (WhatsApp) ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_nao_perturbe (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        telefone_fim10 VARCHAR(10) NOT NULL,
        telefone VARCHAR(20) NULL,
        motivo VARCHAR(120) NULL,
        origem VARCHAR(10) NOT NULL DEFAULT 'manual',
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_np (empresa_id, telefone_fim10)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela whatsapp_nao_perturbe pronta.');
    console.log('\n=== Migration 063 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
