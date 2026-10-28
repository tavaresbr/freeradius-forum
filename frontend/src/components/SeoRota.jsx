import { useLocation } from "react-router-dom";
import useSeo from "../hooks/useSeo";
import { NOME, TITULO, DESCRICAO } from "../constants/siteSeo";

// Paginas publicas que podem ser indexadas; todo o resto (painel, captive portal, login) recebe noindex.
const INDEXAVEIS = {
  "/": { titulo: TITULO, descricao: DESCRICAO },
  "/registro": { titulo: `Criar conta e testar grátis por 7 dias | ${NOME}`, descricao: `Crie a conta da sua empresa na ${NOME} e teste o sistema de Wi-Fi Hotspot por 7 dias, sem cartão.` },
};

export default function SeoRota() {
  const { pathname } = useLocation();
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  const pagina = INDEXAVEIS[caminho];
  useSeo({
    titulo: pagina ? pagina.titulo : NOME,
    descricao: pagina ? pagina.descricao : undefined,
    noindex: !pagina,
    caminho,
  });
  return null;
}
