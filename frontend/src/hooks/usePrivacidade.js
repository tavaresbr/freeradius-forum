import { useEffect, useState } from "react";

// Modo privacidade (para gravar video/tirar print): borra tudo que tem a classe
// "dado-sensivel" (IP publico, chaves, e-mail, nomes de clientes). So no navegador
// (localStorage "privacidade"); nao altera nenhum dado nem a API.
const CHAVE = "privacidade";

export function privacidadeSalva() {
  try { return localStorage.getItem(CHAVE) === "on"; } catch { return false; }
}

export function aplicarPrivacidade(ligada) {
  if (ligada) document.documentElement.setAttribute("data-privacidade", "on");
  else document.documentElement.removeAttribute("data-privacidade");
}

export default function usePrivacidade() {
  const [ligada, setLigada] = useState(privacidadeSalva);
  useEffect(() => {
    aplicarPrivacidade(ligada);
    const aoMudar = (e) => { if (e.key === CHAVE) setLigada(e.newValue === "on"); };
    const aoAlternar = () => setLigada(privacidadeSalva());
    window.addEventListener("storage", aoMudar);
    window.addEventListener("privacidade", aoAlternar);
    return () => { window.removeEventListener("storage", aoMudar); window.removeEventListener("privacidade", aoAlternar); };
  }, [ligada]);
  const alternar = () => {
    const nova = !ligada;
    try { localStorage.setItem(CHAVE, nova ? "on" : "off"); } catch { /* sem storage */ }
    setLigada(nova);
    window.dispatchEvent(new Event("privacidade")); // sincroniza os outros usos do hook na mesma aba
  };
  return { ligada, alternar };
}
