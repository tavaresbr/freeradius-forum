import { Moon, Sun } from "lucide-react";
import useTema from "../hooks/useTema";

export default function ToggleTema({ className = "" }) {
  const { tema, alternar } = useTema();
  const escuro = tema === "escuro";
  return (
    <button type="button" onClick={alternar} aria-label={escuro ? "Tema claro" : "Tema escuro"}
      title={escuro ? "Tema claro" : "Tema escuro"}
      className={`p-2 rounded-lg hover:bg-apex-100 cursor-pointer ${className}`}>
      {escuro ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
