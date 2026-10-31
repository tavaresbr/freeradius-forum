// Link wa.me para abrir uma conversa no WhatsApp (celular ou WhatsApp Web) com a mensagem ja escrita.
// Telefone BR: 10/11 digitos (DDD + numero) ganham o 55; 12/13 digitos ja trazem o DDI; o resto e' invalido (null).
export function telefoneWhatsapp(telefone) {
  const d = String(telefone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

export function linkWhatsapp(telefone, texto = "") {
  const n = telefoneWhatsapp(telefone);
  if (!n) return null;
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

// Troca {{nome}} etc. no navegador (so para a mensagem do wa.me; o envio pela plataforma troca no servidor).
export function aplicarVariaveis(texto, vars) {
  return String(texto || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}
