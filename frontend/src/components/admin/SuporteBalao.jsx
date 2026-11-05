import React, { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";

// Balão de suporte do painel: abre um mini chat com a saudação e leva ao WhatsApp da equipe (número conectado no chat da plataforma).
export default function SuporteBalao({ empresaNome }) {
  const [cfg, setCfg] = useState(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/suporte").then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo) setCfg(d); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  if (!cfg?.ativo || !cfg.whatsapp) return null;
  const texto = `Olá! Preciso de ajuda com o painel${empresaNome ? ` (${empresaNome})` : ""}.`;
  const link = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(texto)}`;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      {aberto && (
        <div role="dialog" aria-label="Suporte" className="w-72 max-w-[calc(100vw-2rem)] bg-[#161a26] border border-gray-700 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between bg-green-600 text-white px-4 py-3">
            <span className="font-medium text-sm">Suporte</span>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="cursor-pointer"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-200 bg-[#0f111a] rounded-xl rounded-tl-sm px-3 py-2">{cfg.mensagem}</p>
            <a href={link} target="_blank" rel="noopener noreferrer" className="block text-center bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg px-3 py-2">Falar no WhatsApp</a>
          </div>
        </div>
      )}
      <button type="button" onClick={() => setAberto((v) => !v)} aria-label="Falar com o suporte" aria-expanded={aberto}
        className="w-12 h-12 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-lg flex items-center justify-center cursor-pointer">
        <MessageCircle size={22} />
      </button>
    </div>
  );
}
