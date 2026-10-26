import LogoApex from "./LogoApex";
import useBranding from "../../hooks/useBranding";

// Marca da plataforma: logo enviada em Configuracoes ou a logo SVG padrao.
// tema="escuro" (padrao) = texto escuro para fundo claro; "claro" = texto branco para fundo escuro.
export default function MarcaApex({ className = "text-xl", tema = "escuro" }) {
  const { nome, logoUrl } = useBranding();
  if (logoUrl) {
    return (
      <span className={`inline-flex items-center gap-2 font-bold ${className}`}>
        <img src={logoUrl} alt={nome} className="h-8 w-auto max-w-[160px] object-contain" />
      </span>
    );
  }
  return <LogoApex nome={nome} className={className} tema={tema} />;
}
