import MarcaApex from "../public/MarcaApex";
import useBranding, { ALTURAS } from "../../hooks/useBranding";
import useLogoEmpresa from "../../hooks/useLogoEmpresa";

// Marca do painel: a logomarca da PROPRIA empresa, ou a da plataforma enquanto ela nao enviar a sua.
export default function MarcaPainel({ slug, className = "text-lg" }) {
  const { logoUrl, nome } = useLogoEmpresa(slug);
  const { tamanhos } = useBranding();
  if (logoUrl) {
    const altura = ALTURAS[tamanhos?.painel] || ALTURAS.m;
    return (
      <span className={`inline-flex items-center max-w-full ${className}`}>
        <img src={logoUrl} alt={nome} style={{ height: altura }} className="logo-enviada w-auto max-w-full object-contain" />
      </span>
    );
  }
  return <MarcaApex className={className} local="painel" />;
}
