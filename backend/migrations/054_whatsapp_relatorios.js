require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Atendimento WhatsApp: nota de satisfacao por conversa e marca de midia expirada (expurgo). Idempotente.
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
    console.log('=== Migration 054: relatorios, satisfacao e expurgo de midia ===\n');
    if (!(await colExists(conn, 'whatsapp_conversas', 'nota_satisfacao'))) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN nota_satisfacao TINYINT NULL, ADD COLUMN satisfacao_em DATETIME NULL, ADD COLUMN satisfacao_pedida_em DATETIME NULL');
      console.log('1. whatsapp_conversas.nota_satisfacao / satisfacao_em / satisfacao_pedida_em criadas.');
    } else console.log('1. colunas de satisfacao ja existem.');
    if (!(await colExists(conn, 'whatsapp_mensagens', 'midia_expirada_em'))) {
      await conn.execute('ALTER TABLE whatsapp_mensagens ADD COLUMN midia_expirada_em DATETIME NULL');
      console.log('2. whatsapp_mensagens.midia_expirada_em criada.');
    } else console.log('2. midia_expirada_em ja existe.');
    console.log('\n=== Migration 054 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
