import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import MarcaApex from "./MarcaApex";

// Cabecalho do site (landing, login e registro). Links com hash funcionam de qualquer pagina.
const LINKS = [["/#vantagens", "Recursos"], ["/#planos", "Planos"], ["/#faq", "Dúvidas"]];

export default function SiteHeader() {
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const ativo = (p) => (pathname === p ? "text-apex-500" : "hover:text-apex-500");

  return (
    <header className="fixed top-0 inset-x-0 z-40 bg-white/95 backdrop-blur text-apex-900 border-b border-apex-100">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/"><MarcaApex /></Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} to={h} className="hover:text-apex-500">{t}</Link>)}
          <Link to="/login" className={ativo("/login")}>Entrar</Link>
          <Link to="/registro" className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold">Teste grátis</Link>
        </nav>
        <button className="md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X /> : <Menu />}</button>
      </div>
      {menu && (
        <nav className="md:hidden px-4 pb-4 flex flex-col gap-3 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} to={h} onClick={() => setMenu(false)}>{t}</Link>)}
          <Link to="/login" onClick={() => setMenu(false)} className={ativo("/login")}>Entrar</Link>
          <Link to="/registro" onClick={() => setMenu(false)} className="text-orange-600 font-semibold">Teste grátis</Link>
        </nav>
      )}
    </header>
  );
}
