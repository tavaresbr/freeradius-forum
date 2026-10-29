require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// promocao_envios.tipo: 'promocao' (marketing) ou 'aviso' (aviso operacional a quem esta conectado). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 057: promocao_envios.tipo ===\n');
    const [[r]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promocao_envios' AND COLUMN_NAME = 'tipo'"
    );
    if (Number(r.n) === 0) {
      await conn.execute("ALTER TABLE promocao_envios ADD COLUMN tipo ENUM('promocao','aviso') NOT NULL DEFAULT 'promocao' AFTER nome");
      console.log('1. promocao_envios.tipo criada (envios antigos = promocao).');
    } else console.log('1. tipo ja existe.');
    console.log('\n=== Migration 057 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
