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
  const modo = b?.modo === "whatsapp" ? "whatsapp" : "chat";
  const mensagem = String(b?.mensagem ?? "").replace(/[<>]/g, "").trim() || MSG_PADRAO;
  if (mensagem.length > 300) return { erro: "A mensagem pode ter no máximo 300 caracteres." };
  return { config: { ativo, telefone, mensagem, modo } };
}

/** "5511999990000@s.whatsapp.net" ou numero solto -> digitos validos ou null. */
function numeroDoJid(v) {
  return telefoneSuporte(String(v || "").split("@")[0]);
}

/** jid "falso" da conversa do chat do painel (nunca e' enviado ao WhatsApp). */
const jidChatPainel = (empresaId) => `painel_${Number(empresaId)}@suporte.painel`;
const ehChatPainel = (jid) => typeof jid === "string" && jid.endsWith("@suporte.painel");

/** Texto do chat: 1-1000 caracteres, sem controle. */
function textoChat(v) {
  const t = String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return t && t.length <= 1000 ? t : null;
}

module.exports = { jidChatPainel, ehChatPainel, textoChat, MSG_PADRAO, telefoneSuporte, validarConfig, numeroDoJid };
