require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

// Identidade por empresa (white label): empresas.branding_json (TEXT) guarda favicon_url, apple_icon_url e
// tamanhos {site, login, painel} da logo. A logo continua em empresas.logo_url. Idempotente.
async function migrate() {
  console.log('=== Migration 062: empresas.branding_json ===\n');
  const [[col]] = await db.execute(
    "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND COLUMN_NAME = 'branding_json'"
  );
  if (col.n > 0) {
    console.log('1. Coluna empresas.branding_json ja existe.');
  } else {
    await db.query('ALTER TABLE empresas ADD COLUMN branding_json TEXT NULL');
    console.log('1. Coluna empresas.branding_json criada.');
  }
  console.log('\n=== Migration 062 concluida ===');
  process.exit(0);
}
migrate().catch((e) => { console.error('Migration 062 falhou:', e.message); process.exit(1); });
