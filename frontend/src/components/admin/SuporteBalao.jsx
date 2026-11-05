import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";

const token = () => { try { return localStorage.getItem("admin_token"); } catch { return null; } };
const headers = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });
const chaveVisto = "suporte_chat_visto";
const lerVisto = () => { try { return Number(localStorage.getItem(chaveVisto)) || 0; } catch { return 0; } };
const hora = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""; };

// Balão de suporte do painel: abre um chat DENTRO do sistema (cai na caixa de entrada WhatsApp da plataforma) ou,
// no modo "whatsapp", leva ao WhatsApp externo da equipe.
export default function SuporteBalao({ empresaNome }) {
  const [cfg, setCfg] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [disponivel, setDisponivel] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const fim = useRef(null);
  const ultimoId = useRef(0);

  useEffect(() => {
    let vivo = true;
    fetch("/api/suporte").then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo) setCfg(d); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  const modoChat = cfg?.ativo && cfg.modo === "chat";

  const buscar = useCallback(async () => {
    try {
      const r = await fetch(`/api/suporte/chat?depois_de=${ultimoId.current}`, { headers: headers() });
      if (!r.ok) return;
      const d = await r.json();
      if (d.disponivel === false) { setDisponivel(false); return; }
      if (d.mensagens?.length) {
        ultimoId.current = Math.max(ultimoId.current, ...d.mensagens.map((m) => m.id));
        setMsgs((atual) => { const ids = new Set(atual.map((m) => m.id)); return [...atual, ...d.mensagens.filter((m) => !ids.has(m.id))]; });
      }
    } catch { /* sem rede: tenta de novo no proximo ciclo */ }
  }, []);

  // Carrega ao montar; com o balao aberto atualiza a cada 4 s, fechado a cada 30 s (so para o contador).
  useEffect(() => {
    if (!modoChat) return undefined;
    buscar();
    const t = setInterval(() => { if (!document.hidden) buscar(); }, aberto ? 4000 : 30000);
    return () => clearInterval(t);
  }, [modoChat, aberto, buscar]);

  useEffect(() => {
    if (aberto) {
      const maior = msgs.length ? Math.max(...msgs.map((m) => m.id)) : 0;
      try { localStorage.setItem(chaveVisto, String(maior)); } catch { /* sem storage */ }
      setNaoLidas(0);
      fim.current?.scrollIntoView?.({ block: "end" });
    } else {
      const visto = lerVisto();
      setNaoLidas(msgs.filter((m) => m.de === "suporte" && m.id > visto).length);
    }
  }, [msgs, aberto]);

  if (!cfg?.ativo || !disponivel) return null;
  if (cfg.modo !== "chat" && !cfg.whatsapp) return null;

  const linkWhats = cfg.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o painel${empresaNome ? ` (${empresaNome})` : ""}.`)}` : null;

  const enviar = async (e) => {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setErro(null);
    try {
      const r = await fetch("/api/suporte/chat", { method: "POST", headers: headers(), body: JSON.stringify({ texto: t }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error || "Não foi possível enviar."); else { setTexto(""); await buscar(); }
    } catch { setErro("Erro de conexão."); }
    setEnviando(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      {aberto && (
        <div role="dialog" aria-label="Suporte" className="w-80 max-w-[calc(100vw-2rem)] bg-[#161a26] border border-gray-700 rounded-2xl shadow-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between bg-green-600 text-white px-4 py-3">
            <span className="font-medium text-sm">Suporte</span>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="cursor-pointer"><X size={16} /></button>
          </div>
          {modoChat ? (
            <>
              <div className="p-3 space-y-2 h-72 overflow-y-auto">
                <p className="text-sm text-gray-200 bg-[#0f111a] rounded-xl rounded-tl-sm px-3 py-2">{cfg.mensagem}</p>
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.de === "cliente" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] text-sm rounded-xl px-3 py-2 break-words whitespace-pre-wrap ${m.de === "cliente" ? "bg-green-700 text-white rounded-tr-sm" : "bg-[#0f111a] text-gray-200 rounded-tl-sm"}`}>
                      {m.texto}
                      <span className="block text-[10px] opacity-60 text-right mt-0.5">{hora(m.criado_em)}</span>
                    </div>
                  </div>
                ))}
                <div ref={fim} />
              </div>
              {erro && <p role="alert" className="px-3 text-xs text-red-400">{erro}</p>}
              <form onSubmit={enviar} className="flex items-center gap-2 p-3 border-t border-gray-800">
                <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} placeholder="Escreva sua mensagem" aria-label="Mensagem"
                  className="min-w-0 flex-1 px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-sm text-gray-200 focus:outline-none" />
                <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar" className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg p-2 cursor-pointer"><Send size={16} /></button>
              </form>
              {linkWhats && <a href={linkWhats} target="_blank" rel="noopener noreferrer" className="text-center text-xs text-gray-400 hover:text-gray-200 pb-3">Prefere o WhatsApp? Abrir conversa externa</a>}
            </>
          ) : (
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-200 bg-[#0f111a] rounded-xl rounded-tl-sm px-3 py-2">{cfg.mensagem}</p>
              <a href={linkWhats} target="_blank" rel="noopener noreferrer" className="block text-center bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg px-3 py-2">Falar no WhatsApp</a>
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={() => setAberto((v) => !v)} aria-label="Falar com o suporte" aria-expanded={aberto}
        className="relative w-12 h-12 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-lg flex items-center justify-center cursor-pointer">
        <MessageCircle size={22} />
        {!aberto && naoLidas > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-[11px] flex items-center justify-center">{naoLidas}</span>}
      </button>
    </div>
  );
}
