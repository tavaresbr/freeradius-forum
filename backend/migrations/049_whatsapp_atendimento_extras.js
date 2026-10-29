require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Atendimento WhatsApp (fase 3): etiquetas e respostas rapidas. Idempotente (CREATE TABLE IF NOT EXISTS).
// Notas internas usam whatsapp_mensagens.direcao = 'nota' (ja existe desde a 048).
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 049: atendimento WhatsApp (etiquetas e respostas rapidas) ===\n');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_etiquetas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        nome VARCHAR(40) NOT NULL,
        cor VARCHAR(7) NOT NULL DEFAULT '#2563eb',
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_etiqueta (empresa_id, nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. whatsapp_etiquetas ok.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversa_etiquetas (
        conversa_id INT NOT NULL,
        etiqueta_id INT NOT NULL,
        empresa_id INT NOT NULL,
        PRIMARY KEY (conversa_id, etiqueta_id),
        KEY idx_wa_ce_etiqueta (empresa_id, etiqueta_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('2. whatsapp_conversa_etiquetas ok.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_respostas_rapidas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        atalho VARCHAR(30) NOT NULL,
        titulo VARCHAR(60) NOT NULL,
        texto TEXT NOT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wa_resposta (empresa_id, atalho)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('3. whatsapp_respostas_rapidas ok.');

    console.log('\n=== Migration 049 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
