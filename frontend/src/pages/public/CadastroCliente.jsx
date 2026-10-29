import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { validarCPF, mascaraCPF } from "../../utils/cpfUtils";
import { redirecionarHotspot } from "../../utils/hotspotRedirect";
import { dataNascimentoValida } from "../../utils/dataUtils";
import BuscaCpf from "../../components/public/BuscaCpf";
import SessaoAtivaAviso from "../../components/public/SessaoAtivaAviso";

export default function CadastroCliente() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mac = searchParams.get("mac") || "";
  const ip = searchParams.get("ip") || "";
  const mikrotikId = searchParams.get("mikrotik_id") || "";
  const empresaId = searchParams.get("empresa_id") || "";
  // portal_id explicito (vindo do redirect entre portais).
  // Necessario propagar pra que /planos-cliente ainda saiba qual portal usar.
  const portalId = searchParams.get("portal_id") || "";
  const cupomUrl = /^[A-Za-z0-9]{3,32}$/.test(searchParams.get("cupom") || "") ? searchParams.get("cupom") : "";

  const [form, setForm] = useState({ nome: "", email: "", telefone: "", cpf: "", data_nascimento: "" });
  const [erro, setErro] = useState(null);
  const [cpfErro, setCpfErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cfg, setCfg] = useState({});
  // Passo 1: so CPF + data de nascimento; o restante aparece depois da busca do cadastro
  const [mostrarResto, setMostrarResto] = useState(false);
  // Resposta do cadastro quando o acesso ja esta conectado em outro aparelho (aguarda a decisao do cliente)
  const [sessaoAtiva, setSessaoAtiva] = useState(null);
  // Dados de contato trazidos de um cadastro existente: se CPF ou data mudarem, somem (nao vazam para outro CPF)
  const preenchidoAuto = useRef(false);
  const limparPreenchido = () => {
    if (!preenchidoAuto.current) return;
    preenchidoAuto.current = false;
    setForm((f) => ({ ...f, nome: "", email: "", telefone: "" }));
  };

  useEffect(() => {
    if (empresaId) {
      fetch(`/api/portal-config/planos?empresa_id=${empresaId}`)
        .then(r => r.json()).then(setCfg).catch(() => {});
    }
  }, [empresaId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
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

    setForm({ ...form, [name]: val });
  };

  const [loginAutomatico, setLoginAutomatico] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!mostrarResto) return; // Enter no passo 1 nao envia o cadastro
    setErro(null);

    if (!form.nome.trim()) { setErro("Informe seu nome"); return; }
    if (!form.email.trim()) { setErro("Informe seu email"); return; }
    if (!form.telefone.trim()) { setErro("Informe seu telefone"); return; }
    if (!validarCPF(form.cpf)) { setCpfErro("CPF inválido"); return; }
    if (!dataNascimentoValida(form.data_nascimento)) { setErro("Data de nascimento inválida"); return; }
    setCpfErro("");

    setEnviando(true);
    try {
      const res = await fetch("/api/clientes/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, mac, ip, mikrotik_id: mikrotikId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao cadastrar");

      // Guarda a data so nesta aba: o pagamento (outra pagina) precisa dela se pedir para desconectar a sessao anterior
      try { if (data.id) sessionStorage.setItem(`hs_dn_${data.id}`, form.data_nascimento); } catch { /* sem storage */ }

      if (data.requer_desconexao) {
        setSessaoAtiva(data);
        return;
      }

      // Plano ativo — auto-login no MikroTik
      if (data.planoAtivo && data.gateway) {
        const minutos = Math.floor((data.tempoRestante || 0) / 60);
        setLoginAutomatico({ nome: data.nome, minutos });
        redirecionarHotspot(data.gateway, data.username, data.password, 2500, data.gateway_info);
        return;
      }

      // Sem plano ativo — vai para planos
      const params = new URLSearchParams({
        mac, ip, mikrotik_id: mikrotikId, empresa_id: empresaId,
        cliente_id: data.id, cliente_nome: data.nome, cliente_email: data.email,
      });
      if (portalId) params.set("portal_id", portalId);
      if (cupomUrl) params.set("cupom", cupomUrl);
      navigate(`/planos-cliente?${params.toString()}`);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const bgStyle = cfg.cor_fundo_1 ? { background: `linear-gradient(135deg, ${cfg.cor_fundo_1}, ${cfg.cor_fundo_2 || cfg.cor_fundo_1})` } : undefined;
  const btnStyle = cfg.cor_botao ? { backgroundColor: cfg.cor_botao } : undefined;

  return (
    <div className={`min-h-screen flex items-center justify-center text-white px-4 py-8 ${!bgStyle ? 'bg-gradient-to-br from-blue-800 via-indigo-900 to-blue-950' : ''}`} style={bgStyle}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in">
          {cfg.logo_url ? (
            <img src={cfg.logo_url} alt="Logo" className="max-h-16 mx-auto mb-4" />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full mb-4 border border-white/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          )}
          <h1 className="text-3xl font-bold mb-2">Seus Dados</h1>
          <p className="text-blue-200 text-sm">Preencha seus dados para continuar</p>
        </div>

        <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl animate-fade-in">
          {loginAutomatico ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Bem-vindo de volta, {loginAutomatico.nome}!</h2>
              <p className="text-gray-600 mb-3">Você tem um plano ativo com <strong>{loginAutomatico.minutos} minutos</strong> restantes.</p>
              <p className="text-sm text-blue-600 font-medium animate-pulse">Conectando automaticamente...</p>
            </div>
          ) : (
            <>
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
                mac={mac}
                mikrotikId={mikrotikId}
                onCancelar={() => setSessaoAtiva(null)}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">CPF *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                  </svg>
                </div>
                <input type="text" name="cpf" value={form.cpf} onChange={handleChange} placeholder="000.000.000-00" required
                  className={`w-full border rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:border-transparent transition-all ${
                    cpfErro ? 'border-red-500 focus:ring-red-400' : form.cpf.replace(/\D/g, '').length === 11 ? 'border-green-500 focus:ring-green-400' : 'border-gray-300 focus:ring-blue-500'
                  }`} />
              </div>
              {cpfErro && <p className="text-red-500 text-xs mt-1">{cpfErro}</p>}
            </div>

            <BuscaCpf
              cpf={form.cpf}
              dataNascimento={form.data_nascimento}
              onDataChange={(v) => setForm((f) => ({ ...f, data_nascimento: v }))}
              mac={mac}
              mikrotikId={mikrotikId}
              onPreencher={({ nome, telefone, email }) => { preenchidoAuto.current = true; setForm((f) => ({
                ...f, nome: nome || f.nome, telefone: telefone || f.telefone, email: email || f.email,
              })); }}
              onLiberarResto={() => setMostrarResto(true)}
              onResetar={() => { setMostrarResto(false); limparPreenchido(); }}
              ringClass="focus:ring-blue-500"
            />

            {mostrarResto && (<>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nome Completo *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input type="text" name="nome" value={form.nome} onChange={handleChange} placeholder="Seu nome completo" required
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="seu@email.com" required
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Telefone *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <input type="text" name="telefone" value={form.telefone} onChange={handleChange} placeholder="(00) 00000-0000" required
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
              </div>
            </div>

            </>)}

            {mostrarResto && (
            <button type="submit" disabled={enviando}
              className={`w-full text-white py-3.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 ${!btnStyle ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700' : 'hover:opacity-90'}`}
              style={btnStyle}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <span>{enviando ? "Processando..." : "Continuar para os Planos"}</span>
            </button>
            )}
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              🔒 Seus dados estão seguros e serão utilizados apenas para processar seu pagamento.
            </p>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
