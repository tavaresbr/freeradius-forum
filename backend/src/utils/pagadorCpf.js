// CPF de quem PAGOU (nao o do cadastro). Ver migration 030 e leadUtils.cpfConfirmado.

// Guarda so digitos e '*' (o Mercado Pago pode mascarar: "***.123.456-**"). Exige 11 posicoes e
// ao menos 4 digitos visiveis; senao devolve null (= pagador desconhecido, nao prova nada).
function normalizarCpfPagador(valor) {
  if (valor == null) return null;
  const s = String(valor).replace(/[.\-\s]/g, "");
  if (!/^[0-9*]{11}$/.test(s)) return null;
  if ((s.match(/\d/g) || []).length < 4) return null;
  return s;
}

// Tira o CPF do pagador do objeto de pagamento do Mercado Pago. Prefere o dado do banco do PIX
// (point_of_interaction.transaction_data.bank_info.payer); depois payer.identification.
// (O formato exato dos campos NAO foi validado contra um MP real; ausente => null.)
function extrairCpfPagador(mp) {
  const banco = mp?.point_of_interaction?.transaction_data?.bank_info?.payer;
  const candidatos = [
    banco?.identification?.number,
    banco?.identification_number,
    mp?.payer?.identification?.number,
  ];
  for (const c of candidatos) {
    const n = normalizarCpfPagador(c);
    if (n) return n;
  }
  return null;
}

// O CPF do pagador (possivelmente mascarado) e' compativel com o CPF do cadastro?
function cpfCompativel(pagador, cpf) {
  const p = normalizarCpfPagador(pagador);
  const c = String(cpf || "").replace(/\D/g, "");
  if (!p || c.length !== 11) return false;
  for (let i = 0; i < 11; i++) if (p[i] !== "*" && p[i] !== c[i]) return false;
  return true;
}

// Marcador gravado em pagamentos.pagador_cpf quando o PIX foi aprovado mas o MP nao informou quem
// pagou: nunca e' compativel com um CPF, entao o pagamento nao confirma a titularidade
// (NULL = pagamento antigo, anterior a esta regra, segue contando).
const PAGADOR_DESCONHECIDO = "DESCONHECIDO";

module.exports = { normalizarCpfPagador, extrairCpfPagador, cpfCompativel, PAGADOR_DESCONHECIDO };
