import LogoApex from "./LogoApex";
import useBranding, { ALTURAS } from "../../hooks/useBranding";

// Marca da plataforma: logo enviada em Configuracoes ou a logo SVG padrao.
// tema="escuro" (padrao) = texto escuro para fundo claro; "claro" = texto branco para fundo escuro.
// empresa (slug) usa a identidade da empresa, com fallback na plataforma.
// local ("site" | "login" | "painel") escolhe o tamanho configurado para a logo enviada.
export default function MarcaApex({ className = "text-xl", tema = "escuro", local = "site", empresa = "" }) {
  const { nome, logoUrl, tamanhos } = useBranding(empresa);
  if (logoUrl) {
    const altura = ALTURAS[tamanhos?.[local]] || ALTURAS.m;
    return (
      <span className={`inline-flex items-center gap-2 font-bold max-w-full ${className}`}>
        <img src={logoUrl} alt={nome} style={{ height: altura }} className="logo-enviada w-auto max-w-full object-contain" />
      </span>
    );
  }
  return <LogoApex nome={nome} className={className} tema={tema} />;
}
