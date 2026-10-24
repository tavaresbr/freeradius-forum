require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

/**
 * Migration 030: CPF de quem PAGOU em pagamentos.
 *
 * pagamentos.cpf e' o CPF do cadastro (digitado pelo cliente). Para um pagamento "confirmar"
 * um CPF (leadUtils.cpfConfirmado) o pagador precisa ser o dono dele — senao quem paga com o
 * proprio banco o CPF de outra pessoa viraria o titular confirmado (grilagem por pagamento).
 *  - PIX: o CPF do pagador vem do Mercado Pago (dado do banco), gravado no webhook.
 *  - Cartao: o CPF do titular informado no formulario, gravado no INSERT.
 * Pode vir mascarado do MP (digitos + '*'). NULL = desconhecido (conta como antes).
 *
 * Idempotente: so adiciona se a coluna nao existe.
 */
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 030: coluna pagador_cpf em pagamentos ===\n');

    const [rows] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagamentos' AND COLUMN_NAME = 'pagador_cpf'"
    );
    if (rows[0].cnt > 0) {
      console.log('   -> pagador_cpf ja existe');
    } else {
      await conn.execute("ALTER TABLE pagamentos ADD COLUMN pagador_cpf VARCHAR(20) NULL DEFAULT NULL");
      console.log('   -> pagador_cpf adicionada');
    }

    console.log('\n=== Migration 030 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration 030:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
