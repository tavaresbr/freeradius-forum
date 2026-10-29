import React, { useEffect } from "react";

export const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
export const btnPrimary = "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
export const btnSecondary = "px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm cursor-pointer disabled:opacity-50";

// Janela simples sobre a tela (fecha com Esc ou clicando fora).
export default function Modal({ titulo, onFechar, children }) {
  useEffect(() => {
    const f = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label={titulo} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{titulo}</h2>
          <button onClick={onFechar} className="text-gray-400 hover:text-white cursor-pointer" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
