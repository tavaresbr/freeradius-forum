require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Atendimento por WhatsApp (caixa de entrada): conversas e mensagens recebidas/enviadas pela Evolution.
// Idempotente (CREATE TABLE IF NOT EXISTS). Sem FK para leads: o historico sobrevive a exclusao do cliente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 048: atendimento WhatsApp ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        jid VARCHAR(80) NOT NULL,
        telefone VARCHAR(20) NULL,
        nome VARCHAR(150) NULL,
        lead_id INT NULL,
        status ENUM('aberta','resolvida') NOT NULL DEFAULT 'aberta',
        nao_lidas INT NOT NULL DEFAULT 0,
        ultima_msg_em DATETIME NULL,
        ultima_msg_previa VARCHAR(200) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_conversa (empresa_id, jid),
        KEY idx_wa_conversa_lista (empresa_id, status, ultima_msg_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. whatsapp_conversas ok.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        conversa_id INT NOT NULL,
        wa_id VARCHAR(120) NOT NULL,
        direcao ENUM('in','out','nota') NOT NULL,
        tipo ENUM('texto','imagem','audio','video','documento','outro') NOT NULL DEFAULT 'texto',
        texto TEXT NULL,
        midia_path VARCHAR(255) NULL,
        midia_mime VARCHAR(100) NULL,
        midia_nome VARCHAR(200) NULL,
        status ENUM('enviando','enviada','entregue','lida','erro') NOT NULL DEFAULT 'enviada',
        admin_id INT NULL,
        erro VARCHAR(255) NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_msg (empresa_id, wa_id),
        KEY idx_wa_msg_conversa (conversa_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. whatsapp_mensagens ok.');

    console.log('\n=== Migration 048 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
