/**
 * Normaliza uma data de nascimento para 'AAAA-MM-DD'.
 * Aceita 'AAAA-MM-DD' ou 'DD/MM/AAAA'. Retorna null se nao for uma data real,
 * for futura ou anterior a 1900.
 * @param {*} valor
 * @param {Date} [agora] - injetavel para teste
 * @returns {string|null}
 */
function normalizarDataNascimento(valor, agora = new Date()) {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  let a, m, d;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (r) {
    [, a, m, d] = r;
  } else if ((r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v))) {
    [, d, m, a] = r;
  } else {
    return null;
  }
  const ano = +a, mes = +m, dia = +d;
  if (ano < 1900) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null;
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  if (dt.getTime() > hoje) return null;
  return `${a}-${m}-${d}`;
}

module.exports = { normalizarDataNascimento };
