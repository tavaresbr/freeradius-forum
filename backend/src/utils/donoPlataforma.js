// Perfil "Dono da plataforma": so ele ve/usa Planos SaaS, Empresas, Assinatura das empresas,
// Atualizar/Backups/Logs. Conferido no BANCO a cada request (cache curto); o JWT nao vale como prova.
// Rede de seguranca: se NENHUM super admin tem a flag (migration nao rodou ou instalacao nova),
// todo super_admin continua valendo como dono, para ninguem ficar trancado para fora.
const TTL_MS = 60 * 1000;
const cache = new Map();
let existeDonoCache = null;

const colunaAusente = (err) => err && (err.code === "ER_BAD_FIELD_ERROR" || err.errno === 1054);

function limparCacheDono() {
  cache.clear();
  existeDonoCache = null;
}

async function existeAlgumDono(db) {
  if (existeDonoCache && existeDonoCache.ate > Date.now()) return existeDonoCache.v;
  const [[r]] = await db.execute("SELECT COUNT(*) AS n FROM admins WHERE dono_plataforma = 1 AND role = 'super_admin'");
  existeDonoCache = { v: r.n > 0, ate: Date.now() + TTL_MS };
  return existeDonoCache.v;
}

/** true se o admin (id) e dono da plataforma. role vem do token (so super_admin chega aqui). */
async function ehDonoPlataforma(adminId, role) {
  if (role !== "super_admin") return false;
  const hit = cache.get(adminId);
  if (hit && hit.ate > Date.now()) return hit.v;
  const db = require("../../db"); // lazy: facilita stub em testes
  let v;
  try {
    if (!(await existeAlgumDono(db))) {
      v = true; // ninguem marcado: comportamento antigo
    } else {
      const [rows] = await db.execute("SELECT dono_plataforma FROM admins WHERE id = ? AND role = 'super_admin' LIMIT 1", [adminId]);
      v = rows.length > 0 && Number(rows[0].dono_plataforma) === 1;
    }
  } catch (err) {
    if (colunaAusente(err)) v = true; // migration 042 ainda nao rodou
    else throw err;
  }
  cache.set(adminId, { v, ate: Date.now() + TTL_MS });
  if (cache.size > 2000) for (const [k, x] of cache) if (x.ate < Date.now()) cache.delete(k);
  return v;
}

module.exports = { ehDonoPlataforma, limparCacheDono };
