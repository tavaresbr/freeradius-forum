// "A coluna ja existe?" com cache curto: deixa o codigo novo funcionar (sem o recurso novo) enquanto a migration
// nao rodou no servidor, em vez de quebrar a consulta inteira.
const db = require("../../db");

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function temColuna(tabela, coluna) {
  const chave = `${tabela}.${coluna}`;
  const c = cache.get(chave);
  if (c && Date.now() - c.t < TTL_MS) return c.v;
  let v = false;
  try {
    const [[r]] = await db.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [tabela, coluna]
    );
    v = Number(r?.n) > 0;
  } catch { v = false; }
  cache.set(chave, { v, t: Date.now() });
  return v;
}

function limparCache() { cache.clear(); }

module.exports = { temColuna, limparCache };
