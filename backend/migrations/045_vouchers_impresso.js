require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Voucher impresso: vouchers.impresso_em (NULL = nunca impresso). Idempotente (INFORMATION_SCHEMA).
async function migrate() {
  const conn = await db.getConnection();
  try {
    console.log('=== Migration 045: vouchers impressos ===\n');
    const [[col]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vouchers' AND COLUMN_NAME = 'impresso_em'"
    );
    if (!col.cnt) {
      await conn.execute('ALTER TABLE vouchers ADD COLUMN impresso_em DATETIME NULL');
      console.log('1. Coluna vouchers.impresso_em adicionada.');
    } else {
      console.log('1. Coluna vouchers.impresso_em ja existe.');
    }
    const [[idx]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vouchers' AND INDEX_NAME = 'idx_vouchers_impresso'"
    );
    if (!idx.cnt) {
      await conn.execute('ALTER TABLE vouchers ADD INDEX idx_vouchers_impresso (empresa_id, impresso_em)');
      console.log('2. Indice idx_vouchers_impresso criado.');
    }
    console.log('\n=== Migration 045 concluida com sucesso! ===');
  } catch (err) {
    console.error('Erro na migration:', err);
    throw err;
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
