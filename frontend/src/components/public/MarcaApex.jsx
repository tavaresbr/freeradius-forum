import { Wifi } from "lucide-react";

// Marca em texto da Apex Telecom (usada onde antes havia imagem de logo).
export default function MarcaApex({ className = "text-xl" }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold text-white ${className}`}>
      <Wifi className="text-orange-400" size={24} /> Apex<span className="text-orange-400">Telecom</span>
    </span>
  );
}
