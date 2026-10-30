import { useLocation } from "react-router-dom";
import useBranding from "../hooks/useBranding";

// Aplica o favicon/icone do iPhone da Identidade do site em TODAS as telas (o useBranding os poe no <head>).
// Painel e login da empresa usam a identidade dela; o resto (super admin, site, portais cativos) a da plataforma.
export default function IconesSite() {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/(?:admin|login)\/([^/]+)/);
  useBranding(m ? m[1] : "");
  return null;
}
