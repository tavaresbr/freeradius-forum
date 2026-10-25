const axios = require("axios");
const { formatarTelefone, formatarCep } = require("./importCadastros");

const BASE_URL = "https://brasilapi.com.br/api/cnpj/v1";

/** Valida CNPJ com verificacao dos digitos. */
function validarCNPJ(cnpj) {
  const n = String(cnpj || "").replace(/\D/g, "");
  if (n.length !== 14 || /^(\d)\1{13}$/.test(n)) return false;
  const dv = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (const d of base) {
      soma += parseInt(d, 10) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(n.slice(0, 12)) === parseInt(n[12], 10) && dv(n.slice(0, 13)) === parseInt(n[13], 10);
}

class CnpjError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const txt = (v, max) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, max) : null; };

/** Converte a resposta da BrasilAPI no formato do cadastro da empresa. */
function normalizar(d, cnpj) {
  const tel = d.ddd_telefone_1 || d.telefone || "";
  const uf = txt(d.uf, 2);
  return {
    cnpj,
    razao_social: txt(d.razao_social, 255),
    nome_fantasia: txt(d.nome_fantasia, 255),
    email: txt(d.email, 255) ? String(d.email).trim().toLowerCase() : null,
    telefone: tel ? formatarTelefone(tel) : null,
    cep: formatarCep(d.cep),
    logradouro: txt([d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" "), 255),
    numero: txt(d.numero, 20),
    complemento: txt(d.complemento, 100),
    bairro: txt(d.bairro, 100),
    cidade: txt(d.municipio, 100),
    uf: uf && /^[A-Za-z]{2}$/.test(uf) ? uf.toUpperCase() : null,
  };
}

/**
 * Consulta um CNPJ na BrasilAPI. Erros viram CnpjError com mensagem segura (sem corpo do provedor).
 */
async function consultarCnpj(cnpjEntrada) {
  const cnpj = String(cnpjEntrada || "").replace(/\D/g, "");
  if (!validarCNPJ(cnpj)) throw new CnpjError(400, "CNPJ inválido");
  try {
    const { data } = await axios.get(`${BASE_URL}/${cnpj}`, { timeout: 8000 });
    return normalizar(data || {}, cnpj);
  } catch (err) {
    const st = err.response && err.response.status;
    if (st === 404 || st === 400) throw new CnpjError(404, "CNPJ não encontrado");
    if (st === 429) throw new CnpjError(503, "Serviço de consulta ocupado. Tente novamente em instantes");
    throw new CnpjError(502, "Serviço de consulta de CNPJ indisponível");
  }
}

module.exports = { validarCNPJ, consultarCnpj, CnpjError, normalizar };
