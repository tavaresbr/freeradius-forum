// Campos do formulário do portal LGPD configuráveis no Editor Visual
// (portais.configuracoes.campos). CPF não entra aqui: é sempre obrigatório.
// Mesma regra de backend/src/utils/camposPortal.js (o servidor valida de novo).
export const CAMPOS_PADRAO = {
  nome: { visivel: true, obrigatorio: false },
  email: { visivel: true, obrigatorio: false },
  telefone: { visivel: true, obrigatorio: false },
};

const CHAVES = ["nome", "email", "telefone"];

/** Mescla a config salva com os padrões; só aceita booleanos; campo oculto nunca é obrigatório. */
export function normalizarCampos(cfg) {
  const origem = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
  const out = {};
  for (const k of CHAVES) {
    const salvo = origem[k] && typeof origem[k] === "object" ? origem[k] : {};
    const visivel = typeof salvo.visivel === "boolean" ? salvo.visivel : CAMPOS_PADRAO[k].visivel;
    const obrigatorio = typeof salvo.obrigatorio === "boolean" ? salvo.obrigatorio : CAMPOS_PADRAO[k].obrigatorio;
    out[k] = { visivel, obrigatorio: visivel && obrigatorio };
  }
  return out;
}

export function emailValido(email) {
  return typeof email === "string" && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Mensagem do primeiro problema do cadastro, ou null se estiver tudo certo. */
export function validarCampos(campos, dados = {}) {
  const nome = String(dados.nome || "").trim();
  const email = String(dados.email || "").trim();
  const telefone = String(dados.telefone || "").replace(/\D/g, "");
  if (campos.nome.visivel && campos.nome.obrigatorio && nome.length < 2) return "Informe seu nome completo";
  if (campos.email.visivel) {
    if (campos.email.obrigatorio && !email) return "Informe seu e-mail";
    if (email && !emailValido(email)) return "E-mail inválido";
  }
  if (campos.telefone.visivel && campos.telefone.obrigatorio && telefone.length < 10) return "Informe um telefone válido com DDD";
  return null;
}
