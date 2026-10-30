require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 069: contrato de 3, 6 e 12 meses com desconto por plano SaaS.
 *
 *  - saas_planos.desconto_3m / desconto_6m / desconto_12m (DECIMAL(5,2) NULL, percentual; NULL = sem desconto)
 *  - assinatura_cobrancas.meses (INT NOT NULL DEFAULT 1): periodo pago naquela cobranca
 *
 * Sem backfill. Idempotente.
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
    console.log('=== Migration 069: periodos com desconto ===\n');
    for (const [tabela, col, ddl] of [
      ['saas_planos', 'desconto_3m', 'ADD COLUMN desconto_3m DECIMAL(5,2) NULL'],
      ['saas_planos', 'desconto_6m', 'ADD COLUMN desconto_6m DECIMAL(5,2) NULL'],
      ['saas_planos', 'desconto_12m', 'ADD COLUMN desconto_12m DECIMAL(5,2) NULL'],
      ['assinatura_cobrancas', 'meses', 'ADD COLUMN meses INT NOT NULL DEFAULT 1'],
    ]) {
      if (!(await colunaExiste(conn, tabela, col))) {
        await conn.execute(`ALTER TABLE ${tabela} ${ddl}`);
        console.log(`   -> ${tabela}.${col} criada`);
      }
    }
    console.log('\nMigration 069 concluida.');
  } catch (err) {
    console.error('Erro na migration 069:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
