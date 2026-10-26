// O JWT vale 1 dia: sem conferir o banco, admin removido/desvinculado ou empresa desativada continuaria
// entrando. Confere o vinculo (admin_empresas) e se a empresa esta ativa, com cache curto.
const TTL_MS = 60 * 1000;
const cache = new Map();

async function adminAtivoNaEmpresa(adminId, empresaId) {
  const chave = `${adminId}:${empresaId}`;
  const hit = cache.get(chave);
  if (hit && hit.ate > Date.now()) return hit.ok;
  const db = require("../../db"); // lazy: facilita stub em testes
  const [rows] = await db.execute(
    `SELECT 1 FROM admin_empresas ae
       JOIN empresas e ON e.id = ae.empresa_id
      WHERE ae.admin_id = ? AND ae.empresa_id = ? AND e.ativo = 1 LIMIT 1`,
    [adminId, empresaId]
  );
  const ok = rows.length > 0;
  cache.set(chave, { ok, ate: Date.now() + TTL_MS });
  if (cache.size > 5000) for (const [k, v] of cache) if (v.ate < Date.now()) cache.delete(k);
  return ok;
}

const limparCacheSessaoAdmin = () => cache.clear();

module.exports = { adminAtivoNaEmpresa, limparCacheSessaoAdmin };
