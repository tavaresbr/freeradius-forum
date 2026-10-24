import React, { useEffect, useRef, useState } from "react";
import { validarCPF, mascaraCPF } from "../../utils/cpfUtils";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";
import BuscaCpf from "../../components/public/BuscaCpf";
import SessaoAtivaAviso from "../../components/public/SessaoAtivaAviso";

export default function CadastroLead() {
  const [form, setForm] = useState({
    nome: "",
    cpf: "",
    email: "",
    telefone: "",
    data_nascimento: "",
    mac: "",
    ip: "",
  });

  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [cpfErro, setCpfErro] = useState("");
  // Passo 1: so CPF + data de nascimento; o restante aparece depois da busca do cadastro
  const [mostrarResto, setMostrarResto] = useState(false);
  // Resposta do login quando o acesso ja esta conectado em outro aparelho (aguarda a decisao do cliente)
  const [sessaoAtiva, setSessaoAtiva] = useState(null);
  // Dados de contato trazidos de um cadastro existente: se CPF ou data mudarem, somem (nao vazam para outro CPF)
  const preenchidoAuto = useRef(false);
  const limparPreenchido = () => {
    if (!preenchidoAuto.current) return;
    preenchidoAuto.current = false;
    setForm((f) => ({ ...f, nome: "", email: "", telefone: "" }));
  };
  const [mikrotikId, setMikrotikId] = useState("");
  const [cfg, setCfg] = useState({});

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
      fetch(`/api/portal-config/lead?empresa_id=${empId}`)
        .then(r => r.json()).then(setCfg).catch(() => {});
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let val = value;

    if (name === "telefone") {
      val = val.replace(/\D/g, "").slice(0, 11);
      val = val.replace(/(\d{2})(\d)/, "($1) $2");
      val = val.replace(/(\d{5})(\d)/, "$1-$2");
    }

    if (name === "cpf") {
      val = mascaraCPF(val);
      const nums = val.replace(/\D/g, "");
      if (nums.length === 11) {
        setCpfErro(validarCPF(val) ? "" : "CPF inválido");
      } else {
        setCpfErro("");
      }
    }

    setForm({ ...form, [name]: val });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!restoVisivel) return; // Enter no passo 1 nao envia o cadastro
    setMensagem(null);
    setErro(null);

    if (!form.nome.trim()) { setErro("Informe seu nome"); return; }
    if (!form.telefone && !form.email) { setErro("Informe telefone ou email"); return; }
    if (form.cpf && !validarCPF(form.cpf)) { setCpfErro("CPF inválido"); return; }
    setCpfErro("");

    setEnviando(true);
    try {
      const res = await fetch("/api/lead-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mikrotik_id: mikrotikId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao cadastrar");
      if (data.requer_desconexao) {
        setSessaoAtiva(data);
        return;
      }
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

  // Sem CPF no portal nao ha passo 1: mostra tudo
  const restoVisivel = mostrarResto || cfg.exibir_cpf === false;

  const bgStyle = cfg.cor_fundo_1 ? { background: `linear-gradient(135deg, ${cfg.cor_fundo_1}, ${cfg.cor_fundo_2 || cfg.cor_fundo_1})` } : undefined;
  const btnStyle = cfg.cor_botao ? { backgroundColor: cfg.cor_botao } : undefined;

  return (
    <div className={`min-h-screen flex items-center justify-center text-white px-4 py-8 ${!bgStyle ? 'bg-gradient-to-br from-emerald-800 via-teal-900 to-cyan-950' : ''}`} style={bgStyle}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          {cfg.logo_url ? (
            <img src={cfg.logo_url} alt="Logo" className="max-h-16 mx-auto mb-4" />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full mb-4 border border-white/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
              </svg>
            </div>
          )}
          <h1 className="text-3xl font-bold mb-2">{cfg.titulo || 'WiFi Grátis'}</h1>
          <p className="text-emerald-200 text-sm">{cfg.subtitulo || 'Preencha seus dados para acessar a internet'}</p>
        </div>

        {/* Form Card */}
        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl animate-fade-in">
          {mensagem && (
            <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-medium flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
                dados={sessaoAtiva}
                cpf={form.cpf}
                dataNascimento={form.data_nascimento}
                mac={form.mac}
                mikrotikId={mikrotikId}
                onCancelar={() => setSessaoAtiva(null)}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {cfg.exibir_cpf !== false && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">CPF *</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    name="cpf"
                    inputMode="numeric"
                    value={form.cpf}
                    onChange={handleChange}
                    placeholder="000.000.000-00"
                    className={`w-full border rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:border-transparent transition-all ${
                      cpfErro ? 'border-red-500 focus:ring-red-400' : form.cpf.replace(/\D/g, '').length === 11 ? 'border-green-500 focus:ring-green-400' : 'border-gray-300 focus:ring-emerald-500'
                    }`}
                  />
                </div>
                {cpfErro && <p className="text-red-500 text-xs mt-1">{cpfErro}</p>}
              </div>
            )}

            {cfg.exibir_cpf !== false && (
              <BuscaCpf
                cpf={form.cpf}
                dataNascimento={form.data_nascimento}
                onDataChange={(v) => setForm((f) => ({ ...f, data_nascimento: v }))}
                mac={form.mac}
                mikrotikId={mikrotikId}
                onPreencher={({ nome, telefone, email }) => { preenchidoAuto.current = true; setForm((f) => ({ ...f, nome: nome || f.nome, telefone: telefone || f.telefone, email: email || f.email })); }}
                onLiberarResto={() => setMostrarResto(true)}
                onResetar={() => { setMostrarResto(false); limparPreenchido(); }}
                ringClass="focus:ring-emerald-500"
              />
            )}

            {restoVisivel && (<>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nome *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  type="text"
                  name="nome"
                  value={form.nome}
                  onChange={handleChange}
                  placeholder="Seu nome"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>


            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="seu@email.com"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Telefone</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <input
                  type="text"
                  name="telefone"
                  value={form.telefone}
                  onChange={handleChange}
                  placeholder="(00) 00000-0000"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 text-center">Informe pelo menos telefone ou email</p>

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
              className={`w-full text-white py-3.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 ${!btnStyle ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700' : 'hover:opacity-90'}`}
              style={btnStyle}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
              </svg>
              <span>{enviando ? "Conectando..." : (cfg.texto_botao || "Conectar à Internet")}</span>
            </button>
            </>)}
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              📶 {cfg.texto_rodape || 'Ao conectar você concorda com os termos de uso da rede WiFi.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
