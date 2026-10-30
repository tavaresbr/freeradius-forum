require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// empresa_configs.config_type e' ENUM: acrescenta 'asaas' (config do Asaas por empresa). Sem isso salvar a config
// e gerar o token do webhook falham. Preserva os valores que o ENUM ja tem. Idempotente.
async function migrate() {
  console.log('=== Migration 068: empresa_configs.config_type + asaas ===\n');
  const [[col]] = await db.execute(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresa_configs' AND COLUMN_NAME = 'config_type'"
  );
  if (!col) {
    console.log('1. Tabela/coluna empresa_configs.config_type nao existe: nada a fazer.');
  } else if (!/^enum\(/i.test(col.COLUMN_TYPE)) {
    console.log('1. config_type nao e ENUM: ja aceita qualquer tipo.');
  } else if (/'asaas'/.test(col.COLUMN_TYPE)) {
    console.log("1. config_type ja aceita 'asaas'.");
  } else {
    const novo = col.COLUMN_TYPE.replace(/\)$/, ",'asaas')");
    await db.query(`ALTER TABLE empresa_configs MODIFY COLUMN config_type ${novo} NOT NULL`);
    console.log("1. 'asaas' adicionado ao ENUM empresa_configs.config_type.");
  }
  console.log('\n=== Migration 068 concluida ===');
  process.exit(0);
}
migrate().catch((e) => { console.error('Migration 068 falhou:', e.message); process.exit(1); });
