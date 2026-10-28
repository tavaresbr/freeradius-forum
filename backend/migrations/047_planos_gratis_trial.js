require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 047: plano gratis e dias de teste por plano SaaS.
 *
 *  - saas_planos.gratis (TINYINT, default 0): plano que nunca vence nem bloqueia
 *  - saas_planos.trial_dias (INT NULL): dias de teste ao contratar o plano (NULL = padrao 7)
 *
 * Sem backfill (nao muda o comportamento dos planos existentes). Idempotente.
 */
async function colunaExiste(conn, tabela, coluna) {
  const [r] = await conn.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tabela, coluna]
  );
  return r.length > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 047: plano gratis / dias de teste ===\n');
    for (const [col, ddl] of [
      ['gratis', 'ADD COLUMN gratis TINYINT(1) NOT NULL DEFAULT 0'],
      ['trial_dias', 'ADD COLUMN trial_dias INT NULL'],
    ]) {
      if (!(await colunaExiste(conn, 'saas_planos', col))) {
        await conn.execute(`ALTER TABLE saas_planos ${ddl}`);
        console.log(`   -> saas_planos.${col} criada`);
      }
    }
    console.log('\nMigration 047 concluida.');
  } catch (err) {
    console.error('Erro na migration 047:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
