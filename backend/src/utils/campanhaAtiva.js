// "Campanha utilizavel": ativa e com pelo menos 1 item. Usada no redirect do hotspot, ao vincular ao portal
// e na rota publica, para nao mandar o cliente a um pre-portal que nao tem o que mostrar (volta extra).
const db = require("../../db");

// Campanha ativa do portal (campanha_ativa_id do proprio portal, mesma empresa), dentro da janela de datas
// (data_inicio/data_fim NULL = sem limite; datas inclusivas). Retorna { id, frequencia } ou null.
async function campanhaAtivaInfo(portalId) {
  const [rows] = await db.execute(
    `SELECT c.id, c.frequencia
       FROM portais p
       JOIN campanhas c ON c.id = p.campanha_ativa_id AND c.empresa_id = p.empresa_id AND c.ativo = 1
      WHERE p.id = ?
        AND (c.data_inicio IS NULL OR c.data_inicio <= CURDATE())
        AND (c.data_fim IS NULL OR c.data_fim >= CURDATE())
        AND EXISTS (SELECT 1 FROM campanha_itens ci WHERE ci.campanha_id = c.id)
      LIMIT 1`,
    [portalId]
  );
  return rows.length ? { id: rows[0].id, frequencia: rows[0].frequencia || "sempre" } : null;
}

// Mesmo que campanhaAtivaInfo, so o id (ou null).
async function campanhaAtivaDoPortal(portalId) {
  const info = await campanhaAtivaInfo(portalId);
  return info ? info.id : null;
}

// Cookie "cv_<id>" gravado pelo player quando a campanha respeita a frequencia (sessao/diaria).
function campanhaJaVista(cookieHeader, campanhaId) {
  const alvo = `cv_${campanhaId}=`;
  return String(cookieHeader || "").split(";").some((c) => c.trim().startsWith(alvo) && c.trim().length > alvo.length);
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

module.exports = { campanhaAtivaInfo, campanhaJaVista, campanhaAtivaDoPortal, motivoCampanhaInutilizavel };
