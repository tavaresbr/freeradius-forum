import { useEffect, useState } from "react";

export const TAMANHOS_PADRAO = { site: "m", login: "g", painel: "m" };
// Altura (px) da logo enviada por preset.
export const ALTURAS = { p: 32, m: 44, g: 60, xg: 80 };
const PADRAO = { nome: "Apex Telecom", logo_url: null, tamanhos: TAMANHOS_PADRAO };

const tamanhosDe = (t) => ({
  site: ALTURAS[t?.site] ? t.site : TAMANHOS_PADRAO.site,
  login: ALTURAS[t?.login] ? t.login : TAMANHOS_PADRAO.login,
  painel: ALTURAS[t?.painel] ? t.painel : TAMANHOS_PADRAO.painel,
});
let cache = null;
let pendente = null;
const ouvintes = new Set();

function carregar() {
  if (!pendente) {
    pendente = fetch("/api/branding", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : PADRAO))
      .catch(() => PADRAO)
      .then((d) => {
        cache = { nome: d.nome || PADRAO.nome, logo_url: d.logo_url || null, tamanhos: tamanhosDe(d.tamanhos) };
        ouvintes.forEach((fn) => fn(cache));
        return cache;
      })
      .finally(() => { pendente = null; });
  }
  return pendente;
}

export default function useBranding() {
  const [b, setB] = useState(cache || PADRAO);
  useEffect(() => {
    ouvintes.add(setB);
    if (cache) setB(cache); else carregar();
    return () => ouvintes.delete(setB);
  }, []);
  return { nome: b.nome, logoUrl: b.logo_url, tamanhos: b.tamanhos || TAMANHOS_PADRAO, recarregar: carregar };
}
