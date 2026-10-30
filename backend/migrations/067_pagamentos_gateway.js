require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Asaas como provedor de PIX: pagamentos.gateway ('asaas' | NULL = Mercado Pago) e mp_pagamento_id como texto
// (o id da cobranca do Asaas e' "pay_xxxx"; o do Mercado Pago continua numerico). Idempotente.
async function migrate() {
  console.log('=== Migration 067: pagamentos.gateway / mp_pagamento_id texto ===\n');

  const [[tipo]] = await db.execute(
    "SELECT DATA_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagamentos' AND COLUMN_NAME = 'mp_pagamento_id'"
  );
  if (tipo && tipo.t !== 'varchar') {
    await db.query('ALTER TABLE pagamentos MODIFY COLUMN mp_pagamento_id VARCHAR(64) NULL');
    console.log('1. pagamentos.mp_pagamento_id convertida para VARCHAR(64).');
  } else {
    console.log('1. pagamentos.mp_pagamento_id ja e texto.');
  }

  const [[col]] = await db.execute(
    "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagamentos' AND COLUMN_NAME = 'gateway'"
  );
  if (col.n > 0) {
    console.log('2. pagamentos.gateway ja existe.');
  } else {
    await db.query('ALTER TABLE pagamentos ADD COLUMN gateway VARCHAR(20) NULL');
    console.log('2. pagamentos.gateway criada.');
  }
  console.log('\n=== Migration 067 concluida ===');
  process.exit(0);
}
migrate().catch((e) => { console.error('Migration 067 falhou:', e.message); process.exit(1); });
