import React, { useEffect, useState } from "react";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";
import SessaoAtivaAviso from "../../components/public/SessaoAtivaAviso";

export default function Voucher() {
  const [codigo, setCodigo] = useState("");
  const [mac, setMac] = useState("");
  const [ip, setIp] = useState("");
  const [mikrotikId, setMikrotikId] = useState("");
  const [cfg, setCfg] = useState({});
  const [erro, setErro] = useState(null);
  const [mensagem, setMensagem] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [sessaoAtiva, setSessaoAtiva] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setMac(params.get("mac") || "");
    setIp(params.get("ip") || "");
    setMikrotikId(params.get("mikrotik_id") || "");
    // Codigo vindo do QR do cartao impresso (so letras/numeros)
    const cod = (params.get("codigo") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
    if (cod) setCodigo(cod);
    const empId = params.get("empresa_id");
    if (empId) {
      fetch(`/api/portal-config/voucher?empresa_id=${encodeURIComponent(empId)}`)
        .then((r) => r.json()).then(setCfg).catch(() => {});
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro(null);
    setMensagem(null);
    if (codigo.replace(/[\s-]/g, "").length < 4) { setErro("Digite o código do voucher"); return; }
    setEnviando(true);
    try {
      const res = await fetch("/api/voucher-portal/resgatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, mac, ip, mikrotik_id: mikrotikId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao validar o voucher");
      if (data.requer_desconexao) { setSessaoAtiva(data); return; }
      setMensagem("Conectando à internet...");
      if (data.gateway && data.username) {
        redirecionarHotspot(data.gateway, data.username, data.password, 1500, data.gateway_info);
      }
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const bgStyle = cfg.cor_fundo_1 ? { background: `linear-gradient(135deg, ${cfg.cor_fundo_1}, ${cfg.cor_fundo_2 || cfg.cor_fundo_1})` } : undefined;
  const btnStyle = cfg.cor_botao ? { backgroundColor: cfg.cor_botao } : undefined;

  return (
    <div className={`min-h-screen flex items-center justify-center text-white px-4 py-8 ${!bgStyle ? "bg-gradient-to-br from-indigo-800 via-purple-900 to-slate-950" : ""}`} style={bgStyle}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {cfg.logo_url && <img src={cfg.logo_url} alt="Logo" className="max-h-16 mx-auto mb-4" />}
          <h1 className="text-3xl font-bold mb-2">{cfg.titulo || "Acesso por Voucher"}</h1>
          <p className="text-sm opacity-80">{cfg.subtitulo || "Digite o código do seu voucher para acessar a internet"}</p>
        </div>

        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl">
          {mensagem && <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-medium">{mensagem}</div>}
          {erro && <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{erro}</div>}
          {sessaoAtiva && (
            <div className="mb-6">
              <SessaoAtivaAviso modoSenha dados={sessaoAtiva} mac={mac} mikrotikId={mikrotikId} onCancelar={() => setSessaoAtiva(null)} />
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código do voucher</label>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 40))}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXXXXXX"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={enviando}
              style={btnStyle}
              className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {enviando ? "Validando..." : cfg.texto_botao || "Conectar à Internet"}
            </button>
          </form>
          {cfg.texto_rodape && <p className="text-xs text-gray-500 text-center mt-4">{cfg.texto_rodape}</p>}
        </div>
      </div>
    </div>
  );
}
