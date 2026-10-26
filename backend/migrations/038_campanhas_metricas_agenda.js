require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Campanhas: metricas por item/dia (views e cliques) + agendamento e frequencia.
// Idempotente: CREATE TABLE IF NOT EXISTS e colunas checadas em INFORMATION_SCHEMA.
async function colunaExiste(conn, tabela, coluna) {
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [tabela, coluna]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 038: campanhas (metricas + agendamento/frequencia) ===\n');

    // 1. Metricas diarias. item_id = 0 e' o total da campanha (UNIQUE nao funciona com NULL);
    //    sem FK em item_id para o historico sobreviver a exclusao do item.
    console.log('1. Criando tabela campanha_metricas...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS campanha_metricas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        campanha_id INT NOT NULL,
        empresa_id INT NOT NULL,
        item_id INT NOT NULL DEFAULT 0,
        dia DATE NOT NULL,
        views INT NOT NULL DEFAULT 0,
        cliques INT NOT NULL DEFAULT 0,
        CONSTRAINT fk_cmet_campanha FOREIGN KEY (campanha_id) REFERENCES campanhas(id) ON DELETE CASCADE,
        CONSTRAINT fk_cmet_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
        UNIQUE KEY uk_cmet (campanha_id, item_id, dia),
        INDEX idx_cmet_empresa_dia (empresa_id, dia)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 2. Agendamento e frequencia
    console.log('2. Colunas de agendamento/frequencia em campanhas...');
    if (!(await colunaExiste(conn, 'campanhas', 'data_inicio'))) {
      await conn.execute('ALTER TABLE campanhas ADD COLUMN data_inicio DATE NULL');
      console.log('   -> data_inicio adicionada.');
    }
    if (!(await colunaExiste(conn, 'campanhas', 'data_fim'))) {
      await conn.execute('ALTER TABLE campanhas ADD COLUMN data_fim DATE NULL');
      console.log('   -> data_fim adicionada.');
    }
    if (!(await colunaExiste(conn, 'campanhas', 'frequencia'))) {
      await conn.execute("ALTER TABLE campanhas ADD COLUMN frequencia ENUM('sempre','sessao','diaria') NOT NULL DEFAULT 'sempre'");
      console.log('   -> frequencia adicionada.');
    }

    console.log('\n=== Migration 038 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
