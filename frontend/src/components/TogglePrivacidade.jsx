import { Eye, EyeOff } from "lucide-react";
import usePrivacidade from "../hooks/usePrivacidade";

export default function TogglePrivacidade({ className = "" }) {
  const { ligada, alternar } = usePrivacidade();
  const rotulo = ligada ? "Modo privacidade ligado (clique para mostrar os dados)" : "Ligar modo privacidade (borra IP, chaves, e-mail e nomes)";
  return (
    <button type="button" onClick={alternar} aria-label={rotulo} title={rotulo} aria-pressed={ligada}
      className={`p-2 rounded-lg hover:bg-apex-100 cursor-pointer ${ligada ? "text-orange-500" : ""} ${className}`}>
      {ligada ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}
