import { useEffect, useState } from "react";

const PADRAO = { nome: "Apex Telecom", logo_url: null };
let cache = null;
let pendente = null;
const ouvintes = new Set();

function carregar() {
  if (!pendente) {
    pendente = fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : PADRAO))
      .catch(() => PADRAO)
      .then((d) => {
        cache = { nome: d.nome || PADRAO.nome, logo_url: d.logo_url || null };
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
  return { nome: b.nome, logoUrl: b.logo_url, recarregar: carregar };
}
