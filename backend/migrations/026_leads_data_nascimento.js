require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 026: data de nascimento em leads.
 *
 * Usada como segundo fator na busca de cadastro por CPF (POST /api/lgpd/consulta-cpf):
 * so preenche o formulario quando CPF + data de nascimento batem com um cadastro
 * da mesma empresa. Opcional (NULL) e preenchida a partir dos proximos cadastros.
 *
 * Idempotente: so adiciona se a coluna nao existe.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 026: coluna data_nascimento em leads ===\n');

    const [rows] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'data_nascimento'"
    );
    if (rows[0].cnt > 0) {
      console.log('   -> data_nascimento ja existe');
    } else {
      await conn.execute("ALTER TABLE leads ADD COLUMN data_nascimento DATE NULL DEFAULT NULL");
      console.log('   -> data_nascimento adicionada');
    }

    console.log('\n=== Migration 026 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 026:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
