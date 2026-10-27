require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Vouchers: tabela de codigos de acesso + portal "Acesso por Voucher" para cada empresa.
// Idempotente: CREATE TABLE IF NOT EXISTS e o portal so e inserido se a empresa nao tem tipo 'voucher'.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 043: vouchers ===\n');

    console.log('1. Tabela vouchers...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        empresa_id INT NOT NULL,
        codigo VARCHAR(32) NOT NULL,
        plano_id INT NOT NULL,
        lote VARCHAR(60) NULL,
        status ENUM('disponivel','usado','cancelado') NOT NULL DEFAULT 'disponivel',
        valido_ate DATE NULL,
        usado_em DATETIME NULL,
        usado_mac VARCHAR(32) NULL,
        usado_ip VARCHAR(45) NULL,
        username VARCHAR(100) NULL,
        criado_por INT NULL,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_vouchers_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
        UNIQUE KEY uk_vouchers_codigo (empresa_id, codigo),
        INDEX idx_vouchers_status (empresa_id, status),
        INDEX idx_vouchers_lote (empresa_id, lote)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('2. Portal "Acesso por Voucher" nas empresas existentes...');
    const [empresas] = await conn.execute('SELECT id FROM empresas');
    let inseridos = 0;
    for (const { id } of empresas) {
      const [[ex]] = await conn.execute("SELECT id FROM portais WHERE empresa_id = ? AND tipo = 'voucher'", [id]);
      if (ex) continue;
      await conn.execute(
        `INSERT INTO portais (empresa_id, nome, slug, tipo, url_redirect, ativo)
         VALUES (?, 'Acesso por Voucher', 'voucher', 'voucher', '/voucher', 1)`,
        [id]
      );
      inseridos++;
    }
    console.log(`   -> ${inseridos} portal(is) criado(s).`);

    console.log('\n=== Migration 043 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
