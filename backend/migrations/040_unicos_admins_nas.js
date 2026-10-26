require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
// se houver duplicatas, NAO aplica o indice e lista os casos para correcao manual (nao apaga nada).
require("dotenv").config();
const db = require("../db");

async function indiceExiste(tabela, nome) {
  const [r] = await db.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [tabela, nome]
  );
  return r.length > 0;
}

async function unico(tabela, coluna, nome) {
  if (await indiceExiste(tabela, nome)) return console.log(`[040] ${nome} ja existe`);
  const [dup] = await db.query(
    `SELECT ${coluna} AS valor, COUNT(*) AS n FROM ${tabela} WHERE ${coluna} IS NOT NULL GROUP BY ${coluna} HAVING n > 1`
  );
  if (dup.length > 0) {
    console.warn(`[040] ${tabela}.${coluna} tem duplicatas — indice NAO criado. Corrija e rode de novo:`);
    dup.forEach((d) => console.warn(`       ${d.valor} (x${d.n})`));
    return;
  }
  await db.query(`ALTER TABLE ${tabela} ADD UNIQUE INDEX ${nome} (${coluna})`);
  console.log(`[040] ${nome} criado`);
}

(async () => {
  try {
    await unico("admins", "email", "uk_admins_email");
    await unico("nas", "nasname", "uk_nas_nasname");
  } catch (err) {
    console.error("[040] falhou:", err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
