// Regras puras do painel por empresa (Super Admin): tempo de casa, motivos e limites. Sem banco.
const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_MAX_GRATIFICACAO = 365;
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 200;
const NOTA_MAX = 1000;

const plural = (n, un, pl) => `${n} ${n === 1 ? un : pl}`;

// "2 anos e 3 meses", "5 meses", "12 dias", "hoje". Meses de calendario, nao 30 dias fixos.
function clienteDesde(criadoEm, agora = new Date()) {
  const d = new Date(criadoEm);
  if (!criadoEm || Number.isNaN(d.getTime()) || d.getTime() > agora.getTime()) return { dias: 0, texto: "hoje" };
  const dias = Math.floor((agora.getTime() - d.getTime()) / DIA_MS);
  let meses = (agora.getFullYear() - d.getFullYear()) * 12 + (agora.getMonth() - d.getMonth());
  if (agora.getDate() < d.getDate()) meses--;
  if (meses >= 12) {
    const anos = Math.floor(meses / 12);
    const resto = meses % 12;
    return { dias, texto: resto ? `${plural(anos, "ano", "anos")} e ${plural(resto, "mês", "meses")}` : plural(anos, "ano", "anos") };
  }
  if (meses >= 1) return { dias, texto: plural(meses, "mês", "meses") };
  return { dias, texto: dias === 0 ? "hoje" : plural(dias, "dia", "dias") };
}

// Motivo obrigatorio nas acoes que mexem em dinheiro/acesso. Devolve { motivo } ou { erro }.
function validarMotivo(v) {
  const motivo = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (motivo.length < MOTIVO_MIN) return { erro: "Informe o motivo (mínimo 3 caracteres)." };
  if (motivo.length > MOTIVO_MAX) return { erro: `O motivo pode ter no máximo ${MOTIVO_MAX} caracteres.` };
  return { motivo };
}

function validarDias(v, max = DIAS_MAX_GRATIFICACAO) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) return { erro: `Informe de 1 a ${max} dias.` };
  return { dias: n };
}

function validarNota(v) {
  const texto = String(v == null ? "" : v).trim();
  if (!texto) return { erro: "Escreva a nota." };
  if (texto.length > NOTA_MAX) return { erro: `A nota pode ter no máximo ${NOTA_MAX} caracteres.` };
  return { texto };
}

const idValido = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Detalhe curto para o historico (cabe em VARCHAR(255)).
const detalhe = (...partes) => partes.filter(Boolean).join(" · ").slice(0, 255);

module.exports = { clienteDesde, validarMotivo, validarDias, validarNota, idValido, detalhe, DIAS_MAX_GRATIFICACAO };
