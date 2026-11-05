// Balao de suporte do painel (puro): validacao da config e link do WhatsApp.
const MSG_PADRAO = "Olá! Precisa de ajuda? Fale com a nossa equipe de suporte pelo WhatsApp.";

/** Telefone BR -> so digitos com DDI 55 (10-13 digitos), ou null. */
function telefoneSuporte(v) {
  const d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

/** Valida o corpo do PUT. telefone vazio = usar o numero conectado no chat da plataforma. */
function validarConfig(b) {
  const ativo = b?.ativo !== false;
  const bruto = String(b?.telefone ?? "").trim();
  const telefone = bruto ? telefoneSuporte(bruto) : "";
  if (bruto && !telefone) return { erro: "Telefone inválido. Informe DDD + número." };
  const mensagem = String(b?.mensagem ?? "").replace(/[<>]/g, "").trim() || MSG_PADRAO;
  if (mensagem.length > 300) return { erro: "A mensagem pode ter no máximo 300 caracteres." };
  return { config: { ativo, telefone, mensagem } };
}

/** "5511999990000@s.whatsapp.net" ou numero solto -> digitos validos ou null. */
function numeroDoJid(v) {
  return telefoneSuporte(String(v || "").split("@")[0]);
}

module.exports = { MSG_PADRAO, telefoneSuporte, validarConfig, numeroDoJid };
