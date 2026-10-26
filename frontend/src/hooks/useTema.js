import { useEffect, useState } from "react";

// Tema global do site/painel: "claro" (padrao) ou "escuro". Guardado em localStorage.
const CHAVE = "tema";

export function temaSalvo() {
  try { return localStorage.getItem(CHAVE) === "escuro" ? "escuro" : "claro"; } catch { return "claro"; }
}

export function aplicarTema(t) {
  document.documentElement.setAttribute("data-theme", t);
}

export default function useTema() {
  const [tema, setTema] = useState(temaSalvo);
  useEffect(() => { aplicarTema(tema); }, [tema]);
  const alternar = () => {
    const novo = tema === "claro" ? "escuro" : "claro";
    try { localStorage.setItem(CHAVE, novo); } catch { /* sem storage */ }
    setTema(novo);
  };
  return { tema, alternar };
}
