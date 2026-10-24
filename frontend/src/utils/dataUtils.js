/** Aplica máscara DD/MM/AAAA enquanto o usuário digita. */
export function mascaraData(value) {
  let v = String(value || "").replace(/\D/g, "").slice(0, 8);
  v = v.replace(/(\d{2})(\d)/, "$1/$2");
  v = v.replace(/(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
  return v;
}

/** true se "DD/MM/AAAA" é uma data real, a partir de 1900 e não futura. */
export function dataNascimentoValida(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || ""));
  if (!m) return false;
  const [d, mes, a] = [+m[1], +m[2], +m[3]];
  if (a < 1900) return false;
  const dt = new Date(a, mes - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== mes - 1 || dt.getDate() !== d) return false;
  return dt.getTime() <= Date.now();
}

/** Formata telefone como (00) 00000-0000 a partir de qualquer entrada. */
export function mascaraTelefone(value) {
  let v = String(value || "").replace(/\D/g, "").slice(0, 11);
  v = v.replace(/(\d{2})(\d)/, "($1) $2");
  v = v.replace(/(\d{5})(\d)/, "$1-$2");
  return v;
}
