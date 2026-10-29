require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Log de auditoria do painel (quem fez o que). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 055: audit_logs ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        admin_id INT NULL,
        acao VARCHAR(60) NOT NULL,
        entidade VARCHAR(60) NULL,
        entidade_id VARCHAR(60) NULL,
        detalhes VARCHAR(500) NULL,
        ip VARCHAR(45) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_audit_empresa_data (empresa_id, criado_em),
        KEY idx_audit_empresa_acao (empresa_id, acao)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. audit_logs ok.');
    console.log('\n=== Migration 055 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
