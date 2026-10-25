/**
 * Credencial padrao do roteador (RouterOS) para o script de instalacao rapida e para
 * pre-preencher o cadastro do equipamento. Vem do .env do servidor (nunca do git):
 *   ROUTER_ADMIN_USER (default "admin") e ROUTER_ADMIN_PASSWORD (vazio = nao configura).
 */
function credenciaisRoteador(env = process.env) {
  const usuario = String(env.ROUTER_ADMIN_USER || "admin").trim() || "admin";
  const senha = env.ROUTER_ADMIN_PASSWORD ? String(env.ROUTER_ADMIN_PASSWORD) : null;
  return { usuario, senha };
}

// Texto seguro dentro de aspas do RouterOS: aspas, \, $, [, ], ? viram escape hex (\22 \5C \24 \5B \5D \3F).
function emStringRouterOS(texto) {
  return String(texto).replace(/["\\$\[\]?]/g, (c) => "\\" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

module.exports = { credenciaisRoteador, emStringRouterOS };
