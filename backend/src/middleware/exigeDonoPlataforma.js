const { ehDonoPlataforma } = require("../utils/donoPlataforma");

// Usar depois de `auth`. Libera so o dono da plataforma (ver utils/donoPlataforma.js).
module.exports = async function exigeDonoPlataforma(req, res, next) {
  try {
    if (req.user && (await ehDonoPlataforma(req.user.id, req.user.role))) return next();
    return res.status(403).json({ error: "Acesso restrito ao dono da plataforma", message: "Acesso restrito ao dono da plataforma" });
  } catch (err) {
    console.error("[dono-plataforma] erro ao verificar:", err.message);
    return res.status(503).json({ error: "Não foi possível verificar a permissão. Tente novamente." });
  }
};
