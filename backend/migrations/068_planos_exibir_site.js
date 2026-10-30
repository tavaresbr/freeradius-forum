require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 068: itens que cada plano SaaS mostra no card do site.
 *
 *  - saas_planos.exibir_site (TEXT NULL): lista JSON de chaves (todos_recursos, teste,
 *    whatsapp, campanhas, exportacao, dominio, portais). NULL = padrao antigo
 *    (recursos incluidos + teste para plano pago).
 *
 * Sem backfill. Idempotente.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 068: saas_planos.exibir_site ===\n');
    const [r] = await conn.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_planos' AND COLUMN_NAME = 'exibir_site' LIMIT 1"
    );
    if (!r.length) {
      await conn.execute('ALTER TABLE saas_planos ADD COLUMN exibir_site TEXT NULL');
      console.log('   -> saas_planos.exibir_site criada');
    }
    console.log('\nMigration 068 concluida.');
  } catch (err) {
    console.error('Erro na migration 068:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
