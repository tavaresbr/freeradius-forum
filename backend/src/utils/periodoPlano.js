// Contrato de 1, 3, 6 ou 12 meses: o total e' SEMPRE calculado aqui (servidor), nunca vem do cliente.
const PERIODOS = [1, 3, 6, 12];

function mesesValidos(v) {
  const n = parseInt(v, 10);
  return PERIODOS.includes(n) ? n : 1;
}

// Percentual de desconto do periodo (0-90). Sem valor/coluna = 0.
function descontoDoPeriodo(plano, meses) {
  if (!plano || meses === 1) return 0;
  const n = Number(plano[`desconto_${meses}m`]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 0;
}

function valorDoPeriodo(valor, meses, desconto = 0) {
  return Math.round(Number(valor) * meses * (1 - desconto / 100) * 100) / 100;
}

// Normaliza o desconto vindo do formulario: vazio = null, senao 0-90 com 2 casas.
function normalizarDesconto(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(n, 90) * 100) / 100;
}

module.exports = { PERIODOS, mesesValidos, descontoDoPeriodo, valorDoPeriodo, normalizarDesconto };
