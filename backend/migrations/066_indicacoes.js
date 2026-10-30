require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

async function colExists(conn, tabela, coluna) {
  const [[r]] = await conn.execute(
    "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [tabela, coluna]
  );
  return Number(r.n) > 0;
}

// Indicacoes (WhatsApp): codigo por cliente, indicacoes (indicador -> indicado, ligadas ao pagamento) e
// pagamentos.indicacao_id. O desconto do indicado e a recompensa (cupom unico) sao calculados no servidor. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 066: indicacoes ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS indicacoes_codigos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        lead_id INT NOT NULL,
        codigo VARCHAR(32) NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ind_codigo (empresa_id, codigo),
        UNIQUE KEY uk_ind_lead (empresa_id, lead_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela indicacoes_codigos pronta.');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS indicacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        codigo_id INT NOT NULL,
        indicador_lead_id INT NOT NULL,
        indicado_cpf VARCHAR(11) NOT NULL,
        pagamento_id INT NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'cadastrada',
        cupom_indicador_id INT NULL,
        motivo VARCHAR(40) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ind_pagamento (pagamento_id),
        KEY idx_ind_indicador (empresa_id, indicador_lead_id, status, criado_em),
        KEY idx_ind_cpf (empresa_id, indicado_cpf, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. tabela indicacoes pronta.');
    if (!(await colExists(conn, 'pagamentos', 'indicacao_id'))) {
      await conn.execute('ALTER TABLE pagamentos ADD COLUMN indicacao_id INT NULL');
      console.log('3. pagamentos.indicacao_id criada.');
    } else console.log('3. pagamentos.indicacao_id ja existe.');
    console.log('\n=== Migration 066 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
