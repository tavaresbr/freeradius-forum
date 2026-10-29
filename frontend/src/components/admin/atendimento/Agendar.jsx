import React, { useCallback, useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

// "AAAA-MM-DDTHH:mm" (hora local) para o input datetime-local
const paraInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const mais = (min) => paraInput(new Date(Date.now() + min * 60000));
const amanha9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return paraInput(d); };
const fmt = (v) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Agenda uma mensagem ou um lembrete de retorno ("me avise se o cliente nao responder") na conversa aberta.
export default function Agendar({ conversaId, headers, textoInicial = "", onFechar }) {
  const [tipo, setTipo] = useState("mensagem");
  const [texto, setTexto] = useState(textoInicial);
  const [quando, setQuando] = useState(mais(30));
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/atendimento/conversas/${conversaId}/agendadas`, { headers });
      const d = await r.json();
      setLista(d.agendadas || []);
    } catch { /* lista e' so informativa */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId]);
  useEffect(() => { carregar(); }, [carregar]);

  const agendar = async (e) => {
    e.preventDefault();
    setErro(""); setBusy(true);
    try {
      const res = await fetch(`/api/atendimento/conversas/${conversaId}/agendadas`, {
        method: "POST", headers, body: JSON.stringify({ tipo, texto, enviar_em: new Date(quando).toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível agendar"); return; }
      setTexto("");
      carregar();
    } catch { setErro("Erro de conexão"); } finally { setBusy(false); }
  };

  const cancelar = async (id) => {
    await fetch(`/api/atendimento/agendadas/${id}`, { method: "DELETE", headers }).catch(() => {});
    carregar();
  };

  return (
    <Modal titulo="Agendar" onFechar={onFechar}>
      <form onSubmit={agendar} className="space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo">
          <button type="button" role="radio" aria-checked={tipo === "mensagem"} onClick={() => setTipo("mensagem")} className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer border ${tipo === "mensagem" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-800 text-gray-300"}`}>Enviar mensagem</button>
          <button type="button" role="radio" aria-checked={tipo === "lembrete"} onClick={() => setTipo("lembrete")} className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer border ${tipo === "lembrete" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-800 text-gray-300"}`}>Lembrar se não responder</button>
        </div>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={4000} className={`${inputCls} resize-none`}
          placeholder={tipo === "mensagem" ? "Mensagem que será enviada ao cliente" : "Anotação do lembrete (opcional)"} />
        <div className="flex flex-wrap gap-2 items-center">
          <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} className={`${inputCls} !w-auto min-w-0`} aria-label="Data e hora" />
          <button type="button" onClick={() => setQuando(mais(30))} className={btnSecondary}>+30 min</button>
          <button type="button" onClick={() => setQuando(mais(120))} className={btnSecondary}>+2 h</button>
          <button type="button" onClick={() => setQuando(amanha9())} className={btnSecondary}>Amanhã 9h</button>
        </div>
        {tipo === "lembrete" && <p className="text-xs text-gray-500">Na hora marcada, se o cliente ainda não tiver escrito, a conversa volta como não lida com uma nota interna.</p>}
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || (tipo === "mensagem" && !texto.trim())} className={btnPrimary}>{busy ? "Agendando..." : "Agendar"}</button>
          <button type="button" className={btnSecondary} onClick={onFechar}>Fechar</button>
        </div>
      </form>
      {lista.length > 0 && (
        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-sm text-gray-300">Agendados nesta conversa</p>
          {lista.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-2 text-sm bg-[#0f111a] border border-gray-800 rounded-lg p-2">
              <div className="min-w-0">
                <p className="text-gray-200">{a.tipo === "lembrete" ? "⏰ Lembrete" : "✉️ Mensagem"} · {fmt(a.enviar_em)}{a.status === "erro" ? " · falhou" : ""}</p>
                {a.texto && <p className="text-gray-400 break-words line-clamp-2">{a.texto}</p>}
                {a.erro && <p className="text-xs text-red-400">{a.erro}</p>}
              </div>
              <button type="button" onClick={() => cancelar(a.id)} className="text-red-400 hover:text-red-300 text-xs cursor-pointer shrink-0">Cancelar</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
