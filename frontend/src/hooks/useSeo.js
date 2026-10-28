import { useEffect } from "react";
import { SITE_URL } from "../constants/siteSeo";

function meta(nome, conteudo) {
  let el = document.querySelector(`meta[name="${nome}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", nome);
    document.head.appendChild(el);
  }
  el.setAttribute("content", conteudo);
}

function canonico(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!href) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Ajusta titulo, description, robots e canonical da rota atual (SPA). O HTML inicial ja traz tudo para a raiz
 * (gerado no build por vitePluginSeo.js); isto mantem as demais rotas corretas depois da navegacao.
 * noindex: paginas privadas e do captive portal nao devem aparecer em buscadores.
 */
export default function useSeo({ titulo, descricao, noindex = false, caminho = "/" } = {}) {
  useEffect(() => {
    if (titulo) document.title = titulo;
    if (descricao) meta("description", descricao);
    meta("robots", noindex ? "noindex,nofollow" : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    canonico(noindex ? null : `${SITE_URL}${caminho === "/" ? "/" : caminho}`);
  }, [titulo, descricao, noindex, caminho]);
}
