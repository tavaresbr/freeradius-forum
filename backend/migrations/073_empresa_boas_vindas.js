require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 073: boas-vindas por WhatsApp a empresas novas.
 *  - empresas.boas_vindas_em: quando a mensagem foi enviada (NULL = ainda nao).
 *    Na criacao da coluna, empresas JA existentes sao marcadas como "enviadas" para nao receberem
 *    boas-vindas atrasadas.
 * Idempotente.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 073: boas-vindas por WhatsApp ===\n');
    const [[c]] = await conn.execute(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND COLUMN_NAME = 'boas_vindas_em'"
    );
    if (Number(c.n) > 0) {
      console.log('1. empresas.boas_vindas_em ja existe.');
    } else {
      await conn.execute('ALTER TABLE empresas ADD COLUMN boas_vindas_em DATETIME NULL');
      const [r] = await conn.execute('UPDATE empresas SET boas_vindas_em = NOW()');
      console.log(`1. empresas.boas_vindas_em criada; ${r.affectedRows} empresa(s) existente(s) marcada(s) como ja atendidas.`);
    }
    console.log('\n=== Migration 073 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 073:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit();
  }
}

migrate();
