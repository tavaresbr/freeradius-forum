/**
 * Campos do formulario do portal LGPD configuraveis no Editor Visual
 * (portais.configuracoes.campos). CPF nao entra aqui: e' sempre obrigatorio.
 *
 * Padroes preservam o comportamento de antes: Nome e Telefone visiveis e NAO exigidos
 * (o servidor nunca exigiu); E-mail aparece como campo opcional.
 */
const CHAVES = ["nome", "email", "telefone"];

const CAMPOS_PADRAO = {
  nome: { visivel: true, obrigatorio: false },
  email: { visivel: true, obrigatorio: false },
  telefone: { visivel: true, obrigatorio: false },
};

/**
 * Mescla a config salva com os padroes: so aceita booleanos, ignora chaves desconhecidas
 * e campo oculto nunca e' obrigatorio.
 * @param {*} cfg - objeto "campos" salvo (ou qualquer lixo)
 * @returns {{nome:{visivel:boolean,obrigatorio:boolean}, email:{...}, telefone:{...}}}
 */
function normalizarCampos(cfg) {
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

function emailValido(email) {
  return typeof email === "string" && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const texto = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Valida o cadastro contra a config dos campos. Devolve a mensagem (portugues) do primeiro
 * problema ou null se estiver tudo certo. Campo oculto e' ignorado.
 * @param {ReturnType<normalizarCampos>} campos
 * @param {{nome?:*, email?:*, telefone?:*}} dados
 * @returns {string|null}
 */
function validarCampos(campos, dados = {}) {
  const nome = texto(dados.nome);
  const email = texto(dados.email);
  const telefone = texto(dados.telefone).replace(/\D/g, "");

  if (campos.nome.visivel && campos.nome.obrigatorio && nome.length < 2) return "Informe seu nome completo";
  if (campos.email.visivel) {
    if (campos.email.obrigatorio && !email) return "Informe seu e-mail";
    if (email && !emailValido(email)) return "E-mail inválido";
  }
  if (campos.telefone.visivel && campos.telefone.obrigatorio && telefone.length < 10) return "Informe um telefone válido com DDD";
  return null;
}

module.exports = { CAMPOS_PADRAO, normalizarCampos, validarCampos, emailValido };
