require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Atendimento WhatsApp (automacao): resposta automatica (anti-loop por conversa), marca de mensagem automatica
// e fila de mensagens agendadas / lembretes de retorno. Idempotente.
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
    console.log('=== Migration 052: automacao do atendimento WhatsApp ===\n');

    if (!(await colExists(conn, 'whatsapp_conversas', 'auto_resposta_em'))) {
      await conn.execute('ALTER TABLE whatsapp_conversas ADD COLUMN auto_resposta_em DATETIME NULL');
      console.log('1. whatsapp_conversas.auto_resposta_em criada.');
    } else console.log('1. auto_resposta_em ja existe.');

    if (!(await colExists(conn, 'whatsapp_mensagens', 'automatica'))) {
      await conn.execute('ALTER TABLE whatsapp_mensagens ADD COLUMN automatica TINYINT(1) NOT NULL DEFAULT 0');
      console.log('2. whatsapp_mensagens.automatica criada.');
    } else console.log('2. automatica ja existe.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_agendadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        conversa_id INT NOT NULL,
        tipo ENUM('mensagem','lembrete') NOT NULL DEFAULT 'mensagem',
        texto TEXT NULL,
        enviar_em DATETIME NOT NULL,
        status ENUM('pendente','enviada','cancelada','erro') NOT NULL DEFAULT 'pendente',
        erro VARCHAR(255) NULL,
        admin_id INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processado_em DATETIME NULL,
        KEY idx_wa_agendada_fila (status, enviar_em),
        KEY idx_wa_agendada_conversa (empresa_id, conversa_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('3. whatsapp_agendadas ok.');

    console.log('\n=== Migration 052 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
