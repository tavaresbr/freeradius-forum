import { useEffect } from "react";

/**
 * No celular (index.css, <768px) as tabelas do painel viram cartoes e o rotulo de cada
 * celula vem de `data-label`. Em vez de editar cada tela, copiamos o texto do <th> para os
 * <td> da mesma coluna. Idempotente; `table[data-sem-cartoes]` fica de fora.
 */
function rotular(raiz) {
  raiz.querySelectorAll("table:not([data-sem-cartoes])").forEach((tabela) => {
    const cab = tabela.querySelector("thead tr");
    if (!cab) return;
    const rotulos = [];
    cab.querySelectorAll("th").forEach((th) => {
      const n = Math.max(1, th.colSpan || 1);
      const texto = th.textContent.trim();
      for (let i = 0; i < n; i++) rotulos.push(texto);
    });
    tabela.querySelectorAll("tbody tr").forEach((tr) => {
      let col = 0;
      Array.from(tr.children).forEach((td) => {
        if (td.tagName !== "TD") return;
        const n = Math.max(1, td.colSpan || 1);
        const texto = n === 1 ? rotulos[col] : "";
        if (texto) {
          if (td.getAttribute("data-label") !== texto) td.setAttribute("data-label", texto);
        } else if (td.hasAttribute("data-label")) {
          td.removeAttribute("data-label");
        }
        col += n;
      });
    });
  });
}

export default function useTabelasMobile(ref) {
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return undefined;
    let quadro = 0;
    const agendar = () => {
      if (quadro) return;
      quadro = requestAnimationFrame(() => {
        quadro = 0;
        rotular(raiz);
      });
    };
    agendar();
    const obs = new MutationObserver(agendar);
    obs.observe(raiz, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, [ref]);
}
