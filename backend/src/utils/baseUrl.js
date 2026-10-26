const { normalizarHost } = require("./entradaSegura");

/**
 * URL base publica deste servidor (para `notification_url` do Mercado Pago etc.).
 * `X-Forwarded-Host` vem do cliente (o nginx nao o sobrescreve): se fosse usado, quem gera o pagamento
 * escolheria o host que recebe o webhook. Prefere SYSTEM_DOMAIN (.env); senao o Host do request, sanitizado.
 */
function baseUrlPublica(req) {
  const host = normalizarHost(process.env.SYSTEM_DOMAIN || req.headers?.host || "");
  return `https://${host}`;
}

module.exports = { baseUrlPublica };
