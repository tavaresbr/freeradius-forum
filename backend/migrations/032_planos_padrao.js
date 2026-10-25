require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { criarPlanosPadrao } = require('../src/utils/empresaSetup');

/**
 * Migration 032: planos padrao (LGPD e Lead) para todas as empresas.
 *
 * - planos.mikrotik_id vira NULLABLE (empresa nova ainda nao tem equipamento; o primeiro
 *   equipamento cadastrado assume os planos sem vinculo).
 * - Backfill: cria LGPD/Lead nas empresas que nao os tem, ja vinculados ao equipamento
 *   mais antigo da empresa quando existir.
 *
 * Idempotente: so altera a coluna se for NOT NULL e so insere o que falta.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 032: planos padrao LGPD/Lead ===\n');

    const [[col]] = await conn.execute(
      "SELECT IS_NULLABLE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planos' AND COLUMN_NAME = 'mikrotik_id'"
    );
    if (col && col.IS_NULLABLE === 'NO') {
      await conn.execute(`ALTER TABLE planos MODIFY COLUMN mikrotik_id ${col.COLUMN_TYPE} NULL DEFAULT NULL`);
      console.log('   -> planos.mikrotik_id agora aceita NULL');
    } else {
      console.log('   -> planos.mikrotik_id ja aceita NULL');
    }

    const [empresas] = await conn.execute('SELECT id FROM empresas');
    for (const { id } of empresas) {
      const [gws] = await conn.execute(
        'SELECT id FROM mikrotiks WHERE empresa_id = ? ORDER BY id ASC LIMIT 1',
        [id]
      );
      await criarPlanosPadrao(conn, id, gws.length ? gws[0].id : null);
    }
    console.log(`   -> ${empresas.length} empresa(s) verificada(s)`);

    console.log('\n=== Migration 032 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 032:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
