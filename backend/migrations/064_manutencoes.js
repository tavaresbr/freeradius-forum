require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Manutencoes programadas (WhatsApp): agenda por equipamento + dedupe dos avisos. Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 064: manutencoes ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS manutencoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        titulo VARCHAR(150) NOT NULL,
        mensagem TEXT NOT NULL,
        mensagem_fim TEXT NULL,
        equipamento_id INT NULL,
        inicio_em DATETIME NOT NULL,
        fim_em DATETIME NOT NULL,
        antecedencias VARCHAR(60) NOT NULL DEFAULT '[1440,60]',
        aviso_fim TINYINT(1) NOT NULL DEFAULT 0,
        avisar_clientes TINYINT(1) NOT NULL DEFAULT 1,
        janela_dias INT NOT NULL DEFAULT 30,
        status VARCHAR(15) NOT NULL DEFAULT 'agendada',
        criado_por INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_manut_empresa (empresa_id, status, inicio_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela manutencoes pronta.');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS manutencao_avisos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        manutencao_id INT NOT NULL,
        empresa_id INT NOT NULL,
        etapa VARCHAR(12) NOT NULL,
        envio_id INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_manut_aviso (manutencao_id, etapa)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. tabela manutencao_avisos pronta.');
    console.log('\n=== Migration 064 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
