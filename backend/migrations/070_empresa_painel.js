require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 070: painel por empresa do Super Admin.
 *  - empresa_notas: anotacoes internas do dono da plataforma sobre a empresa
 *  - empresa_historico: quem mudou plano / deu gratificacao / suspendeu, com motivo
 * Idempotente (CREATE TABLE IF NOT EXISTS).
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 070: painel por empresa ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS empresa_notas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        admin_id INT NULL,
        texto VARCHAR(1000) NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_empresa_notas (empresa_id, criado_em),
        CONSTRAINT fk_empresa_notas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. empresa_notas ok.');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS empresa_historico (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        admin_id INT NULL,
        acao VARCHAR(40) NOT NULL,
        detalhes VARCHAR(255) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_empresa_historico (empresa_id, criado_em),
        CONSTRAINT fk_empresa_historico_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. empresa_historico ok.');
    console.log('\n=== Migration 070 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
