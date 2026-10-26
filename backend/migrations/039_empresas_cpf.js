require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 039: cadastro de conta por pessoa fisica (CPF) alem da empresa (CNPJ).
 * `empresas.tipo_pessoa` ('PJ' padrao, 'PF') e `empresas.cpf` (so digitos, NULL em PJ).
 *
 * Idempotente: so adiciona o que nao existe.
 */
async function colunaExiste(conn, nome) {
  const [rows] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND COLUMN_NAME = ?",
    [nome]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 039: CPF em empresas ===\n');
    if (await colunaExiste(conn, 'tipo_pessoa')) {
      console.log('   -> tipo_pessoa ja existe');
    } else {
      await conn.execute("ALTER TABLE empresas ADD COLUMN tipo_pessoa ENUM('PJ','PF') NOT NULL DEFAULT 'PJ'");
      console.log('   -> tipo_pessoa adicionada');
    }
    if (await colunaExiste(conn, 'cpf')) {
      console.log('   -> cpf ja existe');
    } else {
      await conn.execute('ALTER TABLE empresas ADD COLUMN cpf VARCHAR(14) NULL DEFAULT NULL');
      console.log('   -> cpf adicionada');
    }
    const [idx] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND INDEX_NAME = 'idx_empresas_cpf'"
    );
    if (idx[0].cnt === 0) {
      await conn.execute('CREATE INDEX idx_empresas_cpf ON empresas (cpf)');
      console.log('   -> indice idx_empresas_cpf criado');
    }
    console.log('\n=== Migration 039 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 039:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
