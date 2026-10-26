const axios = require("axios");
const { formatarCep } = require("./importCadastros");

const BASE_URL = "https://brasilapi.com.br/api/cep/v2";

class CepError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const txt = (v, max) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, max) : null; };

/** Converte a resposta da BrasilAPI no formato do cadastro (endereco). */
function normalizar(d, cep) {
  const uf = txt(d.state, 2);
  return {
    cep: formatarCep(cep),
    logradouro: txt(d.street, 255),
    bairro: txt(d.neighborhood, 100),
    cidade: txt(d.city, 100),
    uf: uf && /^[A-Za-z]{2}$/.test(uf) ? uf.toUpperCase() : null,
  };
}

/** Consulta um CEP na BrasilAPI. Erros viram CepError com mensagem segura (sem corpo do provedor). */
async function consultarCep(cepEntrada) {
  const cep = String(cepEntrada || "").replace(/\D/g, "");
  if (cep.length !== 8) throw new CepError(400, "CEP inválido");
  try {
    const { data } = await axios.get(`${BASE_URL}/${cep}`, { timeout: 8000 });
    return normalizar(data || {}, cep);
  } catch (err) {
    const st = err.response && err.response.status;
    if (st === 404 || st === 400) throw new CepError(404, "CEP não encontrado");
    if (st === 429) throw new CepError(503, "Serviço de consulta ocupado. Tente novamente em instantes");
    throw new CepError(502, "Serviço de consulta de CEP indisponível");
  }
}

module.exports = { consultarCep, CepError, normalizar };
