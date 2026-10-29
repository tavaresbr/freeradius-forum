require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Atendimento WhatsApp (dia a dia): dono da conversa (atendente) e citacao de mensagens.
// Idempotente (checa INFORMATION_SCHEMA antes de cada ALTER).
async function colExists(conn, tabela, coluna) {
  const [[r]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [tabela, coluna]
  );
  return Number(r.n) > 0;
}
async function idxExists(conn, tabela, indice) {
  const [[r]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [tabela, indice]
  );
  return Number(r.n) > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 051: atendimento WhatsApp (atendente e citacao) ===\n');

    if (!(await colExists(conn, 'whatsapp_conversas', 'atendente_id'))) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN atendente_id INT NULL AFTER lead_id, ADD COLUMN atribuido_em DATETIME NULL AFTER atendente_id');
      console.log('1. whatsapp_conversas.atendente_id / atribuido_em criadas.');
    } else console.log('1. atendente_id ja existe.');
    if (!(await idxExists(conn, 'whatsapp_conversas', 'idx_wa_conversa_atendente'))) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD KEY idx_wa_conversa_atendente (empresa_id, atendente_id, status)');
      console.log('2. indice idx_wa_conversa_atendente criado.');
    }

    if (!(await colExists(conn, 'whatsapp_mensagens', 'resposta_a_wa_id'))) {
      await conn.execute('ALTER TABLE whatsapp_mensagens ADD COLUMN resposta_a_wa_id VARCHAR(120) NULL, ADD COLUMN resposta_previa VARCHAR(200) NULL');
      console.log('3. whatsapp_mensagens.resposta_a_wa_id / resposta_previa criadas.');
    } else console.log('3. resposta_a_wa_id ja existe.');

    console.log('\n=== Migration 051 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
