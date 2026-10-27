// Aviso "o upgrade compensa" da tela Assinatura (funcao pura: testada em backend/tests/unit/upgradeAviso.test.js).
// planos: [{ id, nome, valor }]; adicionaisValor: soma mensal dos adicionais vigentes; extra: item sendo escolhido.
const LIMIAR = 0.5; // so avisa "quase la" depois de gastar metade do degrau ate o proximo plano

export function avisoUpgrade({ planos, planoAtualId, adicionaisValor = 0, extra = 0 }) {
  const atual = planos.find((p) => p.id === planoAtualId);
  if (!atual) return null;
  const gastoExtra = Number(adicionaisValor) + Number(extra);
  if (!(gastoExtra > 0)) return null;
  const valor = (p) => Number(p.valor);
  const total = valor(atual) + gastoExtra;
  const acima = planos.filter((p) => valor(p) > valor(atual)).sort((a, b) => valor(a) - valor(b));
  // Plano que custa menos (ou igual) ao que a empresa pagaria: melhor negocio, escolhe o mais completo
  const compensa = [...acima].reverse().find((p) => valor(p) <= total);
  if (compensa) {
    return { tipo: "economiza", plano: compensa, diferenca: Math.round((total - valor(compensa)) * 100) / 100 };
  }
  const proximo = acima[0];
  if (proximo && total >= valor(atual) + LIMIAR * (valor(proximo) - valor(atual))) {
    return { tipo: "quase", plano: proximo, diferenca: Math.round((valor(proximo) - total) * 100) / 100 };
  }
  return null;
}
