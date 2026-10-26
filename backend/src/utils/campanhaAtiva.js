// "Campanha utilizavel": ativa e com pelo menos 1 item. Usada no redirect do hotspot, ao vincular ao portal
// e na rota publica, para nao mandar o cliente a um pre-portal que nao tem o que mostrar (volta extra).
const db = require("../../db");

// Campanha ativa do portal (campanha_ativa_id do proprio portal, mesma empresa). Retorna o id ou null.
async function campanhaAtivaDoPortal(portalId) {
  const [rows] = await db.execute(
    `SELECT c.id
       FROM portais p
       JOIN campanhas c ON c.id = p.campanha_ativa_id AND c.empresa_id = p.empresa_id AND c.ativo = 1
      WHERE p.id = ?
        AND EXISTS (SELECT 1 FROM campanha_itens ci WHERE ci.campanha_id = c.id)
      LIMIT 1`,
    [portalId]
  );
  return rows.length ? rows[0].id : null;
}

// Diz por que uma campanha da empresa nao pode ser vinculada ("nao_encontrada" | "inativa" | "sem_itens") ou null se ok.
async function motivoCampanhaInutilizavel(campanhaId, empresaId) {
  const [rows] = await db.execute(
    `SELECT c.ativo, (SELECT COUNT(*) FROM campanha_itens ci WHERE ci.campanha_id = c.id) AS itens
       FROM campanhas c WHERE c.id = ? AND c.empresa_id = ?`,
    [campanhaId, empresaId]
  );
  if (!rows.length) return "nao_encontrada";
  if (!rows[0].ativo) return "inativa";
  if (!Number(rows[0].itens)) return "sem_itens";
  return null;
}

module.exports = { campanhaAtivaDoPortal, motivoCampanhaInutilizavel };
