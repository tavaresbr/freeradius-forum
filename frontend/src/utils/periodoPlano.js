// Contrato de 1, 3, 6 ou 12 meses. So exibicao: o servidor recalcula o total na cobranca.
export const PERIODOS = [1, 3, 6, 12];
export const rotuloPeriodo = (m) => (m === 1 ? "Mensal" : `${m} meses`);

export function descontoDoPeriodo(plano, meses) {
  if (!plano || meses === 1) return 0;
  const n = Number(plano[`desconto_${meses}m`]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 0;
}

export function totalDoPeriodo(plano, meses) {
  const d = descontoDoPeriodo(plano, meses);
  return Math.round(Number(plano.valor) * meses * (1 - d / 100) * 100) / 100;
}

// Periodos oferecidos: sempre o mensal + os que tem desconto cadastrado.
export const periodosDoPlano = (plano) => PERIODOS.filter((m) => m === 1 || descontoDoPeriodo(plano, m) > 0);
// Periodos disponiveis para o conjunto de planos (uniao).
export const periodosDosPlanos = (planos) => PERIODOS.filter((m) => m === 1 || planos.some((p) => descontoDoPeriodo(p, m) > 0));

export const periodoSalvo = () => {
  try { const v = parseInt(localStorage.getItem("periodo_assinatura"), 10); return PERIODOS.includes(v) ? v : 1; } catch { return 1; }
};
