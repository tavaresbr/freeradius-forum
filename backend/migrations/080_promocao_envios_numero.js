require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// promocao_envios.numero_id: numero de WhatsApp que faz o envio (0 = principal; envios antigos ficam no principal). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 080: promocao_envios.numero_id ===\n');
    const [[r]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promocao_envios' AND COLUMN_NAME = 'numero_id'"
    );
    if (Number(r.n) === 0) {
      await conn.execute("ALTER TABLE promocao_envios ADD COLUMN numero_id INT NOT NULL DEFAULT 0");
      console.log('1. promocao_envios.numero_id criada (envios antigos = numero principal).');
    } else console.log('1. numero_id ja existe.');
    console.log('\n=== Migration 080 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
