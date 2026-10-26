import React, { useEffect, useState } from "react";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";
import SessaoAtivaAviso from "../../components/public/SessaoAtivaAviso";

import { urlSegura } from "../../utils/urlSegura";
export default function LoginHotspot() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    mac: "",
    ip: "",
  });

  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [mikrotikId, setMikrotikId] = useState("");
  const [cfg, setCfg] = useState({});
  // Resposta do login quando o acesso ja esta conectado em outro aparelho (aguarda a decisao do cliente)
  const [sessaoAtiva, setSessaoAtiva] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForm((prev) => ({
      ...prev,
      mac: params.get("mac") || "",
      ip: params.get("ip") || "",
    }));
    setMikrotikId(params.get("mikrotik_id") || "");
    
    const empId = params.get("empresa_id");
    if (empId) {
      fetch(`/api/portal-config/login?empresa_id=${empId}`)
        .then(r => r.json()).then(setCfg).catch(() => {});
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensagem(null);
    setErro(null);

    if (!form.username || !form.password) { 
      setErro("Informe usuário e senha"); 
      return; 
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/login-portal/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mikrotik_id: mikrotikId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro de autenticação");
      if (data.requer_desconexao) {
        setSessaoAtiva(data);
        return;
      }
      setMensagem("Autenticado! Conectando à internet...");

      if (data.gateway && data.username) {
        // usa a credencial canonica do backend (CPF limpo) — o campo digitado
        // pode estar com mascara/espacos e o RADIUS rejeitaria
        redirecionarHotspot(data.gateway, data.username, data.password || form.password, 1500, data.gateway_info);
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
    <div className={`min-h-screen flex items-center justify-center text-white px-4 py-8 ${!bgStyle ? 'bg-gradient-to-br from-gray-800 via-gray-900 to-black' : ''}`} style={bgStyle}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          {cfg.logo_url ? (
            <img src={cfg.logo_url} alt="Logo" className="max-h-20 mx-auto mb-6" />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full mb-4 border border-white/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          )}
          <h1 className="text-3xl font-bold mb-2">{cfg.titulo || 'Acesso Wi-Fi'}</h1>
          <p className="text-gray-300 text-sm">{cfg.subtitulo || 'Faça login com seu usuário e senha para acessar a internet'}</p>
        </div>

        {/* Form Card */}
        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl animate-fade-in">
          {mensagem && (
            <div className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm font-medium flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357-2H15" />
              </svg>
              {mensagem}
            </div>
          )}

          {erro && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {erro}
            </div>
          )}

          {sessaoAtiva && (
            <div className="mb-6">
              <SessaoAtivaAviso
                modoSenha
                dados={sessaoAtiva}
                mac={form.mac}
                mikrotikId={mikrotikId}
                onCancelar={() => setSessaoAtiva(null)}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Usuário</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-400">👤</span>
                </div>
                <input
                  type="text"
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  placeholder="Seu usuário"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-400">🔒</span>
                </div>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Sua senha"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">MAC (Automático)</label>
                <input type="text" value={form.mac} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-500 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">IP (Automático)</label>
                <input type="text" value={form.ip} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-500 text-sm" />
              </div>
            </div>

            <button
              type="submit"
              disabled={enviando}
              className={`w-full text-white py-3.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 ${!btnStyle ? 'bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900' : 'hover:opacity-90'}`}
              style={btnStyle}
            >
              <span>{enviando ? "Autenticando..." : (cfg.texto_botao || "Conectar")}</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </form>

          {cfg.link_portal_url && cfg.link_texto_link && (
            <div className="mt-5 text-center">
              <p className="text-sm text-gray-600">
                {cfg.link_texto_antes || ""}
                <a
                  href="#"
                  className="text-blue-600 underline font-medium hover:text-blue-800 transition-colors"
                  onClick={(e) => {
                    e.preventDefault();
                    const params = new URLSearchParams(window.location.search);
                    // Anexa portal_id do destino pra que PlanosCliente/Pagamento
                    // carreguem as configs corretas (PIX/cartao/trial/whatsapp).
                    // Sem isso o destino usa mikrotiks.portal_id que aponta pro portal Login.
                    if (cfg.link_portal_id) {
                      params.set("portal_id", cfg.link_portal_id);
                    }
                    const destino = urlSegura(cfg.link_portal_url);
                    if (destino) window.location.href = destino + (destino.includes("?") ? "&" : "?") + params.toString();
                  }}
                >
                  {cfg.link_texto_link}
                </a>
                {cfg.link_texto_depois || ""}
              </p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              🔒 {cfg.texto_rodape || 'Ao conectar você concorda com os termos de uso da rede.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
