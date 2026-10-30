require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Alertas tecnicos (WhatsApp): feed de quedas/volta de equipamento, WhatsApp desconectado e avisos manuais,
// com controle de "clientes avisados" (1 aviso de queda e 1 de volta por alerta). Idempotente.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 065: alertas tecnicos ===\n');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS alertas_tecnicos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        tipo VARCHAR(25) NOT NULL,
        equipamento_id INT NULL,
        severidade VARCHAR(10) NOT NULL DEFAULT 'alta',
        titulo VARCHAR(150) NOT NULL,
        detalhes VARCHAR(500) NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolvido_em DATETIME NULL,
        clientes_avisados_em DATETIME NULL,
        clientes_volta_avisados_em DATETIME NULL,
        criado_por INT NULL,
        KEY idx_alerta_tec (empresa_id, resolvido_em, criado_em),
        KEY idx_alerta_tec_eq (empresa_id, equipamento_id, tipo, resolvido_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('1. tabela alertas_tecnicos pronta.');
    console.log('\n=== Migration 065 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
