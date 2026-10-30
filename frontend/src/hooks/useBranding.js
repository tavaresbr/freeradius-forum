import { useEffect, useState } from "react";

export const TAMANHOS_PADRAO = { site: "m", login: "g", painel: "m" };
// Altura (px) da logo enviada por preset.
export const ALTURAS = { p: 32, m: 44, g: 60, xg: 80 };
const PADRAO = { nome: "Apex Telecom", logo_url: null, favicon_url: null, apple_icon_url: null, tamanhos: TAMANHOS_PADRAO };

// index.html e' estatico: o favicon e o icone do iPhone enviados em Configuracoes entram no <head> por aqui.
function aplicarIcones(favicon, apple) {
  const link = (rel) => {
    let el = document.head.querySelector(`link[rel="${rel}"]`);
    if (!el) { el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
    return el;
  };
  try { if (favicon) localStorage.setItem("favicon_url", favicon); } catch { /* sem storage: so perde o cache */ }
  if (favicon) {
    const el = link("icon");
    el.removeAttribute("type"); // o tipo do padrao (svg) nao vale para o arquivo enviado
    el.href = favicon;
  }
  // iOS so aceita PNG; sem icone proprio usa o favicon se for PNG
  const iphone = apple || (/\.png$/i.test(favicon || "") ? favicon : null);
  if (iphone) link("apple-touch-icon").href = iphone;
}

const tamanhosDe = (t) => ({
  site: ALTURAS[t?.site] ? t.site : TAMANHOS_PADRAO.site,
  login: ALTURAS[t?.login] ? t.login : TAMANHOS_PADRAO.login,
  painel: ALTURAS[t?.painel] ? t.painel : TAMANHOS_PADRAO.painel,
});
// Cache por empresa ("" = plataforma): /login/<slug> e o painel usam a identidade da empresa.
const caches = new Map();
const pendentes = new Map();
const ouvintes = new Map(); // chave -> Set de setState

const normalizar = (d) => ({ nome: d.nome || PADRAO.nome, logo_url: d.logo_url || null, favicon_url: d.favicon_url || null, apple_icon_url: d.apple_icon_url || null, tamanhos: tamanhosDe(d.tamanhos) });

function carregar(chave) {
  if (!pendentes.has(chave)) {
    const url = chave ? `/api/branding?empresa=${encodeURIComponent(chave)}` : "/api/branding";
    pendentes.set(chave, fetch(url, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : PADRAO))
      .catch(() => PADRAO)
      .then((d) => {
        const c = normalizar(d);
        caches.set(chave, c);
        aplicarIcones(c.favicon_url, c.apple_icon_url);
        (ouvintes.get(chave) || []).forEach((fn) => fn(c));
        return c;
      })
      .finally(() => { pendentes.delete(chave); }));
  }
  return pendentes.get(chave);
}

// useBranding(slug?): identidade da plataforma ou, com slug, a da empresa (o que ela nao enviou cai na plataforma).
export default function useBranding(empresa = "") {
  const chave = String(empresa || "").toLowerCase();
  const [b, setB] = useState(caches.get(chave) || PADRAO);
  useEffect(() => {
    if (!ouvintes.has(chave)) ouvintes.set(chave, new Set());
    ouvintes.get(chave).add(setB);
    if (caches.has(chave)) { setB(caches.get(chave)); aplicarIcones(caches.get(chave).favicon_url, caches.get(chave).apple_icon_url); } else carregar(chave);
    return () => ouvintes.get(chave).delete(setB);
  }, [chave]);
  return { nome: b.nome, logoUrl: b.logo_url, faviconUrl: b.favicon_url, appleIconUrl: b.apple_icon_url, tamanhos: b.tamanhos || TAMANHOS_PADRAO, recarregar: () => carregar(chave) };
}
