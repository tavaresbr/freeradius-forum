require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Estado de monitoramento dos equipamentos (alerta de offline por WhatsApp). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 056: equipamento_status ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS equipamento_status (
        mikrotik_id INT NOT NULL PRIMARY KEY,
        empresa_id INT NOT NULL,
        online TINYINT(1) NOT NULL DEFAULT 1,
        falhas INT NOT NULL DEFAULT 0,
        falha_desde DATETIME NULL,
        alertado TINYINT(1) NOT NULL DEFAULT 0,
        alertado_em DATETIME NULL,
        verificado_em DATETIME NULL,
        erro VARCHAR(200) NULL,
        KEY idx_eqstatus_empresa (empresa_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. equipamento_status ok.');
    console.log('\n=== Migration 056 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
