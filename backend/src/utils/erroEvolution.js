// Motivo legivel de uma falha da Evolution API. O axios so diz "status code 400"; o motivo real vem no
// corpo (data.response.message pode ser texto, lista ou [{ exists:false }] quando o numero nao tem WhatsApp).
function erroEvolution(err, padrao = "Erro ao enviar") {
  const d = err?.response?.data;
  let m = d?.response?.message ?? d?.message ?? d?.error;
  if (Array.isArray(m)) {
    if (m.some((x) => x && typeof x === "object" && x.exists === false)) return "Esse número não tem WhatsApp";
    m = m.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
  } else if (m && typeof m === "object") m = JSON.stringify(m);
  if (typeof m === "string" && m.trim()) return m.trim().slice(0, 300);
  if (err?.code === "ECONNABORTED") return "A Evolution demorou para responder";
  if (err?.response?.status === 401 || err?.response?.status === 403) return "Chave de API da Evolution recusada";
  if (err?.response?.status === 404) return "Instância do WhatsApp não encontrada (conecte o WhatsApp em Integrações)";
  return err?.message || padrao;
}

module.exports = { erroEvolution };
