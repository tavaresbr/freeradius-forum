// Campos obrigatorios no cadastro manual de clientes (tela Clientes).
// PF exige CPF; PJ exige CNPJ. Importacao em massa e fluxos de portal nao passam por aqui.
const vazio = (v) => v == null || String(v).trim() === "";

/**
 * Lista os rotulos dos campos obrigatorios que faltam num registro.
 * @param {Object} r - { nome, cpf, cnpj, tipo_pessoa, email, telefone, data_nascimento }
 * @returns {string[]}
 */
function camposFaltando(r) {
  const faltando = [];
  if (vazio(r.nome)) faltando.push("Nome");
  if (r.tipo_pessoa === "PJ") {
    if (vazio(r.cnpj)) faltando.push("CNPJ");
  } else if (vazio(r.cpf)) {
    faltando.push("CPF");
  }
  if (vazio(r.email)) faltando.push("E-mail");
  if (vazio(r.data_nascimento)) faltando.push("Data de nascimento");
  if (vazio(r.telefone)) faltando.push("Telefone");
  return faltando;
}

const mensagemFaltando = (lista) => `Preencha os campos obrigatórios: ${lista.join(", ")}`;

module.exports = { camposFaltando, mensagemFaltando };
