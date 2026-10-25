require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 037: cadastro completo da empresa (razao social, nome fantasia, endereco).
 * Preenchido a partir da consulta de CNPJ (GET /api/cnpj/:cnpj) no registro e na tela Empresas.
 *
 * Idempotente: so adiciona as colunas que nao existem.
 */
const COLUNAS = {
  razao_social: 'VARCHAR(255)',
  nome_fantasia: 'VARCHAR(255)',
  cep: 'VARCHAR(10)',
  logradouro: 'VARCHAR(255)',
  numero: 'VARCHAR(20)',
  complemento: 'VARCHAR(100)',
  bairro: 'VARCHAR(100)',
  cidade: 'VARCHAR(100)',
  uf: 'CHAR(2)',
};

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 037: cadastro completo em empresas ===\n');
    for (const [nome, tipo] of Object.entries(COLUNAS)) {
      const [rows] = await conn.execute(
        "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND COLUMN_NAME = ?",
        [nome]
      );
      if (rows[0].cnt > 0) {
        console.log(`   -> ${nome} ja existe`);
      } else {
        await conn.execute(`ALTER TABLE empresas ADD COLUMN ${nome} ${tipo} NULL DEFAULT NULL`);
        console.log(`   -> ${nome} adicionada`);
      }
    }
    console.log('\n=== Migration 037 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 037:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
