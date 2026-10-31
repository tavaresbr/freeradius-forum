import { useEffect, useState } from "react";

const token = () => localStorage.getItem("admin_token");
const chamar = async (caminho, opcoes = {}) => {
  const res = await fetch(`/api/plataforma/boas-vindas${caminho}`, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
  });
  return { ok: res.ok, corpo: await res.json().catch(() => ({})) };
};
const area = "w-full min-w-0 px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-sm text-gray-200";

export default function BoasVindasModal({ onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [conectado, setConectado] = useState(null);
  const [msg, setMsg] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [telefoneTeste, setTelefoneTeste] = useState("");

  useEffect(() => {
    chamar("").then((r) => {
      if (r.ok) { setCfg(r.corpo.config); setConectado(r.corpo.whatsapp_conectado); }
      else setMsg({ tipo: "erro", texto: r.corpo.message || "Não foi possível carregar." });
    }).catch(() => setMsg({ tipo: "erro", texto: "Erro de conexão." }));
  }, []);

  const salvar = async () => {
    setSalvando(true); setMsg(null);
    const r = await chamar("", { method: "PUT", body: JSON.stringify(cfg) });
    setSalvando(false);
    setMsg({ tipo: r.ok ? "ok" : "erro", texto: r.corpo.message || (r.ok ? "Salvo." : "Erro ao salvar.") });
  };

  const testar = async (tipo) => {
    setMsg(null);
    const mensagem = tipo === "lembrete" ? cfg.lembrete_ativacao.mensagem : cfg.mensagem;
    const r = await chamar("/teste", { method: "POST", body: JSON.stringify({ telefone: telefoneTeste, tipo, mensagem }) });
    setMsg({ tipo: r.ok ? "ok" : "erro", texto: r.corpo.message || (r.ok ? "Enviado." : "Erro no teste.") });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-1">Mensagens automáticas por WhatsApp</h2>
        <p className="text-gray-500 text-sm mb-4">Enviadas às empresas novas pelo número WhatsApp da plataforma.</p>
        {conectado === false && (
          <p className="mb-3 px-3 py-2 rounded-lg text-sm bg-yellow-900/20 text-yellow-400">
            O WhatsApp da plataforma não está conectado: nada será enviado até conectar (as boas-vindas pendentes saem depois, em até 24 h do cadastro).
          </p>
        )}
        {msg && <p className={`mb-3 px-3 py-2 rounded-lg text-sm ${msg.tipo === "ok" ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>{msg.texto}</p>}
        {!cfg ? <p className="text-gray-500">Carregando...</p> : (
          <div className="space-y-5">
            <section>
              <label className="flex items-center gap-2 text-white font-medium">
                <input type="checkbox" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} />
                Enviar boas-vindas automaticamente a cada empresa nova
              </label>
              <textarea className={`${area} mt-2`} rows={7} maxLength={1000} value={cfg.mensagem} onChange={(e) => setCfg({ ...cfg, mensagem: e.target.value })} />
              <p className="text-gray-600 text-xs mt-1">Variáveis: {"{{nome}} {{empresa}} {{plano}} {{trial_ate}} {{link_painel}}"}</p>
            </section>
            <section>
              <label className="flex items-center gap-2 text-white font-medium">
                <input type="checkbox" checked={cfg.lembrete_ativacao.ativo} onChange={(e) => setCfg({ ...cfg, lembrete_ativacao: { ...cfg.lembrete_ativacao, ativo: e.target.checked } })} />
                Lembrete 48 h depois se a empresa ainda não cadastrou nenhum equipamento
              </label>
              <textarea className={`${area} mt-2`} rows={4} maxLength={1000} value={cfg.lembrete_ativacao.mensagem}
                onChange={(e) => setCfg({ ...cfg, lembrete_ativacao: { ...cfg.lembrete_ativacao, mensagem: e.target.value } })} />
            </section>
            <section className="border-t border-gray-800 pt-4">
              <p className="text-gray-400 text-sm mb-2">Enviar teste (com dados de exemplo) para:</p>
              <div className="flex flex-wrap gap-2">
                <input className={`${area} max-w-[14rem]`} placeholder="(85) 99999-9999" value={telefoneTeste} onChange={(e) => setTelefoneTeste(e.target.value)} />
                <button type="button" onClick={() => testar("boas_vindas")} className="px-3 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800">Testar boas-vindas</button>
                <button type="button" onClick={() => testar("lembrete")} className="px-3 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800">Testar lembrete</button>
              </div>
            </section>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onFechar} className="px-4 py-2 rounded-lg text-sm bg-gray-700 text-gray-300">Fechar</button>
          <button type="button" onClick={salvar} disabled={!cfg || salvando} className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
