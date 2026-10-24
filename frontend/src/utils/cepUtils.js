/** Aplica máscara 00000-000 enquanto o usuário digita. */
export function mascaraCEP(value) {
  const v = String(value || "").replace(/\D/g, "").slice(0, 8);
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
}

/** Converte a resposta do ViaCEP em { logradouro, bairro, cidade, uf } (null se o CEP não existe). */
export function parseViaCep(dados) {
  if (!dados || dados.erro) return null;
  return {
    logradouro: dados.logradouro || "",
    bairro: dados.bairro || "",
    cidade: dados.localidade || "",
    uf: String(dados.uf || "").toUpperCase().slice(0, 2),
  };
}

/**
 * Consulta o ViaCEP (só o CEP sai do navegador). Devolve o endereço ou null
 * se o CEP não existir; lança erro em falha de rede/timeout.
 */
export async function buscarCep(cep, { timeoutMs = 6000 } = {}) {
  const digitos = String(cep || "").replace(/\D/g, "");
  if (digitos.length !== 8) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ViaCEP HTTP ${res.status}`);
    return parseViaCep(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
