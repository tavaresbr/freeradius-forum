const { formatarTelefone, formatarCep } = require("./importCadastros");
const { validarCNPJ } = require("./cnpjClient");

const txt = (v, max) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, max) : null; };

/**
 * Normaliza os campos de cadastro da empresa vindos do corpo (registro e tela Empresas).
 * @returns {{dados?: Object, erro?: string}} dados sempre com todas as chaves (NULL quando vazio)
 */
function sanitizarEmpresa(body) {
  const cnpjNum = String(body.cnpj || "").replace(/\D/g, "");
  if (cnpjNum && !validarCNPJ(cnpjNum)) return { erro: "CNPJ inválido" };
  const telCru = txt(body.telefone, 50);
  const telefone = telCru ? formatarTelefone(telCru) : null;
  if (telCru && !telefone) return { erro: "Telefone inválido (use DDD + número)" };
  const cepCru = txt(body.cep, 10);
  const cep = cepCru ? formatarCep(cepCru) : null;
  if (cepCru && !cep) return { erro: "CEP inválido" };
  const ufCru = txt(body.uf, 2);
  if (ufCru && !/^[A-Za-z]{2}$/.test(ufCru)) return { erro: "UF inválida" };
  return {
    dados: {
      cnpj: cnpjNum || null,
      telefone,
      razao_social: txt(body.razao_social, 255),
      nome_fantasia: txt(body.nome_fantasia, 255),
      cep,
      logradouro: txt(body.logradouro, 255),
      numero: txt(body.numero, 20),
      complemento: txt(body.complemento, 100),
      bairro: txt(body.bairro, 100),
      cidade: txt(body.cidade, 100),
      uf: ufCru ? ufCru.toUpperCase() : null,
    },
  };
}

module.exports = { sanitizarEmpresa };
