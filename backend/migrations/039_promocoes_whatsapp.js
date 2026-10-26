require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Promocoes por WhatsApp: opt-out no lead + fila de envio (envios e destinatarios).
// Idempotente: colunas checadas em INFORMATION_SCHEMA e CREATE TABLE IF NOT EXISTS.
async function colExists(conn, table, col) {
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, col]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 039: promocoes por WhatsApp ===\n');

    console.log('1. leads.whatsapp_optout / whatsapp_optout_em...');
    if (!(await colExists(conn, 'leads', 'whatsapp_optout'))) {
      await conn.execute('ALTER TABLE leads ADD COLUMN whatsapp_optout TINYINT(1) NOT NULL DEFAULT 0');
      console.log('   -> whatsapp_optout adicionada.');
    }
    if (!(await colExists(conn, 'leads', 'whatsapp_optout_em'))) {
      await conn.execute('ALTER TABLE leads ADD COLUMN whatsapp_optout_em DATETIME NULL');
      console.log('   -> whatsapp_optout_em adicionada.');
    }

    console.log('2. Tabela promocao_envios...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promocao_envios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        nome VARCHAR(150) NOT NULL,
        mensagem TEXT NOT NULL,
        filtros_json TEXT NULL,
        status ENUM('rascunho','em_andamento','pausada','concluida','cancelada') NOT NULL DEFAULT 'rascunho',
        total INT NOT NULL DEFAULT 0,
        enviados INT NOT NULL DEFAULT 0,
        falhas INT NOT NULL DEFAULT 0,
        ignorados INT NOT NULL DEFAULT 0,
        criado_por INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        iniciado_em DATETIME NULL,
        concluido_em DATETIME NULL,
        CONSTRAINT fk_promenv_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
        INDEX idx_promenv_empresa (empresa_id, criado_em),
        INDEX idx_promenv_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('3. Tabela promocao_destinatarios...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promocao_destinatarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        envio_id INT NOT NULL,
        empresa_id INT NOT NULL,
        lead_id INT NULL,
        telefone VARCHAR(20) NOT NULL,
        nome VARCHAR(255) NULL,
        status ENUM('pendente','enviado','erro','ignorado') NOT NULL DEFAULT 'pendente',
        erro_msg VARCHAR(500) NULL,
        enviado_em DATETIME NULL,
        CONSTRAINT fk_promdest_envio FOREIGN KEY (envio_id) REFERENCES promocao_envios(id) ON DELETE CASCADE,
        UNIQUE KEY uk_promdest (envio_id, telefone),
        INDEX idx_promdest_status (envio_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('\n=== Migration 039 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
