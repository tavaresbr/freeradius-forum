import React, { useEffect, useRef, useState } from "react";
import { validarCPF, mascaraCPF } from "../../utils/cpfUtils";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";
import BuscaCpf from "../../components/public/BuscaCpf";
import { normalizarCampos, validarCampos } from "../../utils/camposPortal";

export default function CadastroLGPD() {
  const [form, setForm] = useState({
    cpf: "",
    nome: "",
    email: "",
    telefone: "",
    data_nascimento: "",
    aceite: false,
    mac: "",
    ip: "",
  });

  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);

  const [mikrotikId, setMikrotikId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [cfg, setCfg] = useState({});
  const campos = normalizarCampos(cfg.campos);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get("mac") || "";
    const ip = params.get("ip") || "";
    const mtkId = params.get("mikrotik_id") || "";
    const empId = params.get("empresa_id") || "";
    setForm((prev) => ({ ...prev, mac, ip }));
    setMikrotikId(mtkId);
    setEmpresaId(empId);

    if (empId) {
      fetch(`/api/portal-config/lgpd?empresa_id=${empId}`)
        .then(r => r.json()).then(setCfg).catch(() => {});
    }
  }, []);

  const [cpfErro, setCpfErro] = useState("");
  // Passo 1: so CPF + data de nascimento; o restante aparece depois da busca do cadastro
  const [mostrarResto, setMostrarResto] = useState(false);
  // Dados de contato trazidos de um cadastro existente: se CPF ou data mudarem, somem (nao vazam para outro CPF)
  const preenchidoAuto = useRef(false);
  const limparPreenchido = () => {
    if (!preenchidoAuto.current) return;
    preenchidoAuto.current = false;
    setForm((f) => ({ ...f, nome: "", email: "", telefone: "" }));
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = value;

    if (name === "cpf") {
      val = mascaraCPF(val);
      const nums = val.replace(/\D/g, "");
      if (nums.length === 11) {
        setCpfErro(validarCPF(val) ? "" : "CPF inválido");
      } else {
        setCpfErro("");
      }
    }

    if (name === "telefone") {
      val = val.replace(/\D/g, "").slice(0, 11);
      val = val.replace(/(\d{2})(\d)/, "($1) $2");
      val = val.replace(/(\d{5})(\d)/, "$1-$2");
    }

    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : val,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!mostrarResto) return; // Enter no passo 1 nao envia o cadastro
    setMensagem(null);
    setErro(null);

    if (!validarCPF(form.cpf)) {
      setCpfErro("CPF inválido");
      return;
    }
    setCpfErro("");

    const erroCampos = validarCampos(campos, form);
    if (erroCampos) {
      setErro(erroCampos);
      return;
    }

    try {
      const res = await fetch("/api/lgpd/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mikrotik_id: mikrotikId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao cadastrar");
      setMensagem("Cadastro realizado! Conectando...");

      if (data.gateway && data.username) {
        redirecionarHotspot(data.gateway, data.username, data.password, 1500, data.gateway_info);
      }
    } catch (err) {
      setErro(err.message);
    }
  };

  const bgStyle = cfg.cor_fundo_1 ? { background: `linear-gradient(135deg, ${cfg.cor_fundo_1}, ${cfg.cor_fundo_2 || cfg.cor_fundo_1})` } : undefined;
  const btnStyle = cfg.cor_botao ? { backgroundColor: cfg.cor_botao } : undefined;

  return (
    <div className={`min-h-screen flex items-center justify-center text-white px-4 py-8 ${!bgStyle ? 'bg-gradient-to-br from-sky-800 via-blue-900 to-blue-950' : ''}`} style={bgStyle}>
      <div className="w-full max-w-md">
        {/* Header com ícone */}
        <div className="text-center mb-8 animate-fade-in">
          {cfg.logo_url ? (
            <img src={cfg.logo_url} alt="Logo" className="max-h-16 mx-auto mb-4" />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full mb-4 border border-white/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          )}
          <h1 className="text-3xl font-bold mb-2">{cfg.titulo || 'Cadastro'}</h1>
          <p className="text-blue-200 text-sm">{cfg.subtitulo || 'Seus dados protegidos pela Lei Geral de Proteção de Dados'}</p>
        </div>

        {/* Card do formulário */}
        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl backdrop-blur-sm animate-fade-in">
          {mensagem && (
            <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-medium flex items-center gap-3 animate-fade-in">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {mensagem}
            </div>
          )}
          {erro && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium" role="alert">
              {erro}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CPF *
              </label>
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
                    cpfErro ? 'border-red-500 focus:ring-red-400' : form.cpf.replace(/\D/g, '').length === 11 ? 'border-green-500 focus:ring-green-400' : 'border-gray-300 focus:ring-blue-500'
                  }`}
                  required
                />
              </div>
              {cpfErro && <p className="text-red-500 text-xs mt-1">{cpfErro}</p>}
            </div>

            <BuscaCpf
              cpf={form.cpf}
              dataNascimento={form.data_nascimento}
              onDataChange={(v) => setForm((f) => ({ ...f, data_nascimento: v }))}
              mac={form.mac}
              mikrotikId={mikrotikId}
              onPreencher={({ nome, telefone, email }) => { preenchidoAuto.current = true; setForm((f) => ({
                ...f,
                nome: campos.nome.visivel ? (nome || f.nome) : f.nome,
                telefone: campos.telefone.visivel ? (telefone || f.telefone) : f.telefone,
                email: campos.email.visivel ? (email || f.email) : f.email,
              })); }}
              onLiberarResto={() => setMostrarResto(true)}
              onResetar={() => { setMostrarResto(false); limparPreenchido(); }}
              ringClass="focus:ring-blue-500"
            />

            {mostrarResto && (<>

            {campos.nome.visivel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome Completo{campos.nome.obrigatorio ? " *" : ""}
                </label>
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
                    required={campos.nome.obrigatorio}
                    placeholder="Seu nome completo"
                    className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            {campos.email.visivel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  E-mail{campos.email.obrigatorio ? " *" : ""}
                </label>
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
                    required={campos.email.obrigatorio}
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            {campos.telefone.visivel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Telefone{campos.telefone.obrigatorio ? " *" : ""}
                </label>
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
                    required={campos.telefone.obrigatorio}
                    placeholder="(00) 00000-0000"
                    className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  MAC (Automático)
                </label>
                <input
                  type="text"
                  name="mac"
                  value={form.mac}
                  readOnly
                  className="w-full border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  IP (Automático)
                </label>
                <input
                  type="text"
                  name="ip"
                  value={form.ip}
                  readOnly
                  className="w-full border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-500 text-sm"
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="aceite"
                  id="aceite"
                  checked={form.aceite}
                  onChange={handleChange}
                  required
                  className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="aceite" className="text-sm text-gray-700 leading-relaxed cursor-pointer">
                  {cfg.texto_lgpd || "Aceito os termos da Lei Geral de Proteção de Dados (LGPD) e autorizo o tratamento dos meus dados pessoais, incluindo a data de nascimento, que será utilizada para confirmar minha identidade e recuperar meu cadastro. *"}
                </label>
              </div>
            </div>

            <button
              type="submit"
              className={`w-full text-white py-3.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 ${!btnStyle ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' : 'hover:opacity-90'}`}
              style={btnStyle}
            >
              <span>{cfg.texto_botao || 'Cadastrar e Continuar'}</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            </>)}
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              🔒 {cfg.texto_rodape || 'Seus dados estão protegidos e serão utilizados apenas para os fins estabelecidos em nossa política de privacidade.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
