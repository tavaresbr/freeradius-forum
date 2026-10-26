// Destinos de navegacao vindos de configuracao/servidor/query: so http(s) ou caminho relativo
// do proprio site. Bloqueia javascript:, data: e "//host" (open redirect / XSS por location.href).
export function urlSegura(url, fallback = null) {
  if (typeof url !== "string") return fallback;
  const u = url.trim();
  if (/^\/(?![\/\\])/.test(u)) return u;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : fallback;
  } catch {
    return fallback;
  }
}
