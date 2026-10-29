import { useEffect, useState } from "react";

// Logomarca da empresa (white label), por slug: { logoUrl, nome, carregando, recarregar }.
// Cache em modulo; recarregar() refaz a busca de todos os usuarios do hook.
const cache = new Map();
const ouvintes = new Set();

async function buscar(slug) {
  try {
    const r = await fetch(`/api/empresas/by-slug/${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
    });
    const d = r.ok ? await r.json() : {};
    cache.set(slug, { logoUrl: d.logo_url || null, nome: d.nome || "" });
  } catch {
    if (!cache.has(slug)) cache.set(slug, { logoUrl: null, nome: "" });
  }
  ouvintes.forEach((fn) => fn());
}

export default function useLogoEmpresa(slug) {
  const [, forcar] = useState(0);
  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    ouvintes.add(fn);
    if (slug && !cache.has(slug)) buscar(slug);
    return () => ouvintes.delete(fn);
  }, [slug]);
  const d = cache.get(slug);
  return { logoUrl: d?.logoUrl || null, nome: d?.nome || "", carregando: !d, recarregar: () => buscar(slug) };
}
