// Regras puras das metricas do painel Super Admin (sem banco): series sem buracos, conversao e MRR.
const DIA_MS = 24 * 60 * 60 * 1000;
const PERIODOS = [7, 30, 90];

function periodoValido(v) {
  const n = parseInt(v, 10);
  return PERIODOS.includes(n) ? n : 30;
}

const dois = (n) => String(n).padStart(2, "0");
const chaveDia = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const chaveMes = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}`;

// Uma entrada por dia dos ultimos `dias` dias (dias sem dado = 0). linhas: [{ dia: 'AAAA-MM-DD', total }]
function preencherSerieDias(linhas, dias, agora = new Date()) {
  const mapa = new Map((linhas || []).map((l) => [String(l.dia), Number(l.total) || 0]));
  const saida = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(agora.getTime() - i * DIA_MS);
    const chave = chaveDia(d);
    saida.push({ chave, rotulo: `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`, valor: mapa.get(chave) || 0 });
  }
  return saida;
}

// Uma entrada por mes dos ultimos `meses` meses. linhas: [{ mes: 'AAAA-MM', total }]
function preencherSerieMeses(linhas, meses, agora = new Date()) {
  const mapa = new Map((linhas || []).map((l) => [String(l.mes), Number(l.total) || 0]));
  const saida = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const chave = chaveMes(d);
    saida.push({ chave, rotulo: `${dois(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`, valor: mapa.get(chave) || 0 });
  }
  return saida;
}

// Primeiro dia do mes mais antigo da serie (filtro SQL).
function inicioSerieMeses(meses, agora = new Date()) {
  return chaveDia(new Date(agora.getFullYear(), agora.getMonth() - (meses - 1), 1));
}

// Percentual inteiro; null quando nao ha base (evita mostrar 0% enganoso).
function taxaConversao(criadas, convertidas) {
  const c = Number(criadas) || 0;
  if (c <= 0) return null;
  return Math.round(((Number(convertidas) || 0) / c) * 100);
}

// Receita mensal recorrente: so assinatura ATIVA de plano pago; ciclo != 30 dias entra proporcional.
function mrrDeAssinaturas(linhas) {
  let total = 0;
  for (const l of linhas || []) {
    if (l.status !== "ativa" || Number(l.gratis) === 1) continue;
    const valor = Number(l.valor) || 0;
    const ciclo = Number(l.ciclo_dias) || 30;
    if (valor > 0 && ciclo > 0) total += (valor * 30) / ciclo;
  }
  return Math.round(total * 100) / 100;
}

const soma = (serie) => serie.reduce((a, x) => a + x.valor, 0);

module.exports = {
  PERIODOS, periodoValido, preencherSerieDias, preencherSerieMeses, inicioSerieMeses, taxaConversao, mrrDeAssinaturas, soma,
};
