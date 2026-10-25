import LogoApex from "./LogoApex";
import useBranding from "../../hooks/useBranding";

// Marca da plataforma: logo enviada em Configuracoes ou a logo SVG padrao.
export default function MarcaApex({ className = "text-xl" }) {
  const { nome, logoUrl } = useBranding();
  if (logoUrl) {
    return (
      <span className={`inline-flex items-center gap-2 font-bold text-white ${className}`}>
        <img src={logoUrl} alt={nome} className="h-8 w-auto max-w-[160px] object-contain" />
      </span>
    );
  }
  return <LogoApex nome={nome} className={className} />;
}
