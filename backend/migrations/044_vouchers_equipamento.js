require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Voucher exclusivo por equipamento: vouchers.mikrotik_id. NULL = legado (vale em qualquer equipamento da empresa).
// Idempotente: coluna/indice checados em INFORMATION_SCHEMA; o backfill so toca linhas ainda NULL.
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 044: vouchers por equipamento ===\n');

    const [[col]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vouchers' AND COLUMN_NAME = 'mikrotik_id'"
    );
    if (!col.cnt) {
      await conn.execute('ALTER TABLE vouchers ADD COLUMN mikrotik_id INT NULL AFTER plano_id');
      console.log('1. Coluna vouchers.mikrotik_id adicionada.');
    } else {
      console.log('1. Coluna vouchers.mikrotik_id ja existe.');
    }

    const [[idx]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vouchers' AND INDEX_NAME = 'idx_vouchers_equip'"
    );
    if (!idx.cnt) {
      await conn.execute('ALTER TABLE vouchers ADD INDEX idx_vouchers_equip (empresa_id, mikrotik_id)');
      console.log('2. Indice idx_vouchers_equip criado.');
    }

    const [r] = await conn.execute(
      `UPDATE vouchers v JOIN planos p ON p.id = v.plano_id AND p.empresa_id = v.empresa_id
          SET v.mikrotik_id = p.mikrotik_id
        WHERE v.mikrotik_id IS NULL AND p.mikrotik_id IS NOT NULL`
    );
    console.log(`3. Backfill: ${r.affectedRows} voucher(s) ligado(s) ao equipamento do plano.`);

    console.log('\n=== Migration 044 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
