import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import MarcaApex from "./MarcaApex";
import ToggleTema from "../ToggleTema";
import LinkPainel from "./LinkPainel";

// Cabecalho do site (landing, login e registro). Links com hash funcionam de qualquer pagina.
const LINKS = [["/#recursos", "Recursos"], ["/#planos", "Planos"], ["/#faq", "Dúvidas"]];

export default function SiteHeader() {
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const ativo = (p) => (pathname === p ? "text-apex-500" : "hover:text-apex-500");

  return (
    <header className="tema-site fixed top-0 inset-x-0 z-40 bg-white/95 backdrop-blur text-apex-900 border-b border-apex-100">
      <div className="max-w-6xl mx-auto px-4 min-h-16 py-2 flex items-center justify-between">
        <Link to="/"><MarcaApex local="site" /></Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} to={h} className="hover:text-apex-500">{t}</Link>)}
          <LinkPainel to="/login" className={ativo("/login")}>Entrar</LinkPainel>
          <LinkPainel to="/registro" className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-semibold">Teste grátis</LinkPainel>
          <ToggleTema />
        </nav>
        <button className="md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X /> : <Menu />}</button>
      </div>
      {menu && (
        <nav className="md:hidden px-4 pb-4 flex flex-col gap-3 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} to={h} onClick={() => setMenu(false)}>{t}</Link>)}
          <LinkPainel to="/login" onClick={() => setMenu(false)} className={ativo("/login")}>Entrar</LinkPainel>
          <LinkPainel to="/registro" onClick={() => setMenu(false)} className="text-orange-600 font-semibold">Teste grátis</LinkPainel>
          <ToggleTema className="self-start" />
        </nav>
      )}
    </header>
  );
}
