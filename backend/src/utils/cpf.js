/**
 * Valida CPF com verificacao dos digitos (mesmo algoritmo de frontend/src/utils/cpfUtils.js).
 * @param {string} cpf - CPF com ou sem mascara
 * @returns {boolean}
 */
function validarCPF(cpf) {
  const nums = String(cpf || "").replace(/\D/g, "");
  if (nums.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(nums)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(nums[i], 10) * (10 - i);
  let resto = soma % 11;
  const dig1 = resto < 2 ? 0 : 11 - resto;
  if (parseInt(nums[9], 10) !== dig1) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(nums[i], 10) * (11 - i);
  resto = soma % 11;
  const dig2 = resto < 2 ? 0 : 11 - resto;
  return parseInt(nums[10], 10) === dig2;
}

module.exports = { validarCPF };
