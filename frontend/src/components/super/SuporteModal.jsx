import { useEffect, useState } from "react";

const token = () => localStorage.getItem("admin_token");
const chamar = async (opcoes = {}) => {
  const res = await fetch("/api/plataforma/suporte", { ...opcoes, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" } });
  return { ok: res.ok, corpo: await res.json().catch(() => ({})) };
};
const campo = "w-full min-w-0 px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-sm text-gray-200";

// Balão de suporte do painel das empresas: liga/desliga, número (vazio = o conectado no chat) e saudação.
export default function SuporteModal({ onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [conectado, setConectado] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    chamar().then((r) => {
      if (r.ok) { setCfg(r.corpo.config); setConectado(r.corpo.numero_conectado); }
      else setMsg({ tipo: "erro", texto: r.corpo.message || "Não foi possível carregar." });
    }).catch(() => setMsg({ tipo: "erro", texto: "Erro de conexão." }));
  }, []);

  const salvar = async () => {
    const r = await chamar({ method: "PUT", body: JSON.stringify(cfg) });
    setMsg({ tipo: r.ok ? "ok" : "erro", texto: r.corpo.message || (r.ok ? "Salvo." : "Erro ao salvar.") });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onFechar}>
      <div role="dialog" aria-label="Balão de suporte" className="bg-[#161a26] border border-gray-800 rounded-xl p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-gray-100 font-medium">Balão de suporte</h2>
        {!cfg && !msg && <p className="text-sm text-gray-400">Carregando...</p>}
        {cfg && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} /> Mostrar o balão no painel das empresas
            </label>
            <label className="block text-sm text-gray-300">WhatsApp do suporte (DDD + número)
              <input value={cfg.telefone} onChange={(e) => setCfg({ ...cfg, telefone: e.target.value })} placeholder={conectado ? `Vazio = o conectado no chat (${conectado})` : "Vazio = o conectado no chat"} className={`${campo} mt-1`} />
            </label>
            <label className="block text-sm text-gray-300">Saudação
              <textarea rows={3} maxLength={300} value={cfg.mensagem} onChange={(e) => setCfg({ ...cfg, mensagem: e.target.value })} className={`${campo} mt-1`} />
            </label>
            {!cfg.telefone && !conectado && <p className="text-xs text-yellow-500">Nenhum número disponível: conecte o WhatsApp da plataforma ou informe um número, senão o balão não aparece.</p>}
          </>
        )}
        {msg && <p role="alert" className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onFechar} className="border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm cursor-pointer">Fechar</button>
          {cfg && <button onClick={salvar} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 cursor-pointer">Salvar</button>}
        </div>
      </div>
    </div>
  );
}
