const { formatarTelefone, formatarCep } = require("./importCadastros");
const { validarCNPJ } = require("./cnpjClient");
const { validarCPF } = require("./cpf");

const txt = (v, max) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, max) : null; };

/**
 * Normaliza os campos de cadastro da empresa vindos do corpo (registro e tela Empresas).
 * @returns {{dados?: Object, erro?: string}} dados sempre com todas as chaves (NULL quando vazio)
 */
function sanitizarEmpresa(body) {
  const pf = String(body.tipo_pessoa || "").toUpperCase() === "PF";
  const cpfNum = pf ? String(body.cpf || "").replace(/\D/g, "") : "";
  if (pf && !validarCPF(cpfNum)) return { erro: "CPF inválido" };
  // Pessoa fisica nao tem CNPJ/razao social: ignora o que vier no corpo
  const cnpjNum = pf ? "" : String(body.cnpj || "").replace(/\D/g, "");
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
      tipo_pessoa: pf ? "PF" : "PJ",
      cpf: pf ? cpfNum : null,
      cnpj: cnpjNum || null,
      telefone,
      razao_social: pf ? null : txt(body.razao_social, 255),
      nome_fantasia: pf ? null : txt(body.nome_fantasia, 255),
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

const MSG_CNPJ_DUPLICADO = "Já existe uma empresa cadastrada com este CNPJ";

/**
 * Ja existe outra empresa com esse CNPJ? Compara so os digitos (cadastros antigos podem estar
 * com mascara). `ignorarId` = empresa sendo editada.
 * @param {{execute: Function}} conn - pool ou conexao
 */
async function cnpjDuplicado(conn, cnpj, ignorarId = null) {
  if (!cnpj) return false;
  const [rows] = await conn.execute(
    `SELECT id FROM empresas
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') = ?
        ${ignorarId ? "AND id <> ?" : ""}
      LIMIT 1`,
    ignorarId ? [cnpj, ignorarId] : [cnpj]
  );
  return rows.length > 0;
}

const MSG_CPF_DUPLICADO = "Já existe uma conta cadastrada com este CPF";

/** Ja existe outra conta de pessoa fisica com esse CPF? (so digitos) */
async function cpfDuplicado(conn, cpf, ignorarId = null) {
  if (!cpf) return false;
  const [rows] = await conn.execute(
    `SELECT id FROM empresas
      WHERE tipo_pessoa = 'PF' AND cpf = ?
        ${ignorarId ? "AND id <> ?" : ""}
      LIMIT 1`,
    ignorarId ? [cpf, ignorarId] : [cpf]
  );
  return rows.length > 0;
}

module.exports = { sanitizarEmpresa, cnpjDuplicado, MSG_CNPJ_DUPLICADO, cpfDuplicado, MSG_CPF_DUPLICADO };
