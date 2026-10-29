require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Cupom de desconto: tabelas cupons / cupom_usos e pagamentos.cupom_id / valor_original. Idempotente.
// Valores em CENTAVOS (como planos.valor e pagamentos.valor); cupom percentual guarda 1-99.
async function colExists(conn, tabela, coluna) {
  const [[r]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [tabela, coluna]
  );
  return Number(r.n) > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 060: cupom de desconto ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        codigo VARCHAR(32) NOT NULL,
        tipo ENUM('percentual','valor') NOT NULL,
        valor INT NOT NULL,
        plano_id INT NULL,
        valido_ate DATE NULL,
        max_usos INT NULL,
        usos INT NOT NULL DEFAULT 0,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cupons_codigo (empresa_id, codigo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela cupons pronta.');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cupom_usos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        cupom_id INT NOT NULL,
        pagamento_id INT NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cupom_uso_pagamento (pagamento_id),
        KEY idx_cupom_uso_cupom (empresa_id, cupom_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. tabela cupom_usos pronta.');
    if (!(await colExists(conn, 'pagamentos', 'cupom_id'))) {
      await conn.execute('ALTER TABLE pagamentos ADD COLUMN cupom_id INT NULL, ADD COLUMN valor_original INT NULL');
      console.log('3. pagamentos.cupom_id / valor_original criadas.');
    } else console.log('3. colunas de pagamentos ja existem.');
    console.log('\n=== Migration 060 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
