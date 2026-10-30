require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 071: plano favorito (em destaque) na pagina inicial do site.
 *
 *  - saas_planos.destaque (TINYINT(1) NOT NULL DEFAULT 0): no maximo um plano com 1
 *    (garantido pelo controller). Nenhum marcado = a landing usa o padrao antigo.
 *
 * Sem backfill. Idempotente.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 071: saas_planos.destaque ===\n');
    const [r] = await conn.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_planos' AND COLUMN_NAME = 'destaque' LIMIT 1"
    );
    if (!r.length) {
      await conn.execute('ALTER TABLE saas_planos ADD COLUMN destaque TINYINT(1) NOT NULL DEFAULT 0');
      console.log('   -> saas_planos.destaque criada');
    }
    console.log('\nMigration 071 concluida.');
  } catch (err) {
    console.error('Erro na migration 071:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
