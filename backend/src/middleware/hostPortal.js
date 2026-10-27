// Em host de dominio proprio de empresa (Host != SYSTEM_DOMAIN) so o portal do cliente final existe:
// login/registro do painel respondem 404 (defesa alem do 404 do nginx).
const BLOQUEADOS = [/^\/api\/auth\/login\/?$/, /^\/api\/admin\/login\/?$/, /^\/api\/registro\/?$/];

module.exports = function hostPortal(req, res, next) {
  const sys = String(process.env.SYSTEM_DOMAIN || "").trim().toLowerCase();
  const host = String(req.hostname || "").toLowerCase();
  if (sys && host && host !== sys && host !== "localhost" && host !== "127.0.0.1" && BLOQUEADOS.some((r) => r.test(req.path))) {
    return res.status(404).json({ error: "Não encontrado" });
  }
  next();
};
