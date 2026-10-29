import { useParams, useSearchParams } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import { redirecionarHotspot, limparCpf } from "../../utils/hotspotRedirect";
import SessaoAtivaAviso from "../../components/public/SessaoAtivaAviso";

// Retomada do PIX (sem gerar outro pagamento) quando o acesso gratis manda o cliente ao login do hotspot e
// ele volta para esta mesma pagina. Fica so na aba (sessionStorage); tudo em try/catch.
const chavePix = (planoId, clienteId) => `hs_pix_${planoId}_${clienteId || "-"}`;
// So vale por 30 min: depois disso um PIX salvo e' velho e a pagina volta a mostrar a escolha PIX/cartao.
const VALIDADE_PIX_SALVO_MS = 30 * 60 * 1000;
const lerPixSalvo = (planoId, clienteId) => {
  try {
    const salvo = JSON.parse(sessionStorage.getItem(chavePix(planoId, clienteId)) || "null");
    if (!salvo || !salvo.em || Date.now() - salvo.em > VALIDADE_PIX_SALVO_MS) return null;
    return salvo;
  } catch { return null; }
};
const salvarPix = (planoId, clienteId, dados) => {
  try { sessionStorage.setItem(chavePix(planoId, clienteId), JSON.stringify(dados)); } catch { /* sem storage */ }
};
const limparPix = (planoId, clienteId) => {
  try { sessionStorage.removeItem(chavePix(planoId, clienteId)); } catch { /* sem storage */ }
};

export default function Pagamento() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [plano, setPlano] = useState(null);
  const [metodo, setMetodo] = useState(null); // null = escolha, "pix" ou "cartao"

  // PIX state
  const [qrCode, setQrCode] = useState(null);
  const [copiaCola, setCopiaCola] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [mpPagamentoId, setMpPagamentoId] = useState(null);
  const [pagamentoId, setPagamentoId] = useState(null); // id interno (pagamentos.id) - usado no pix-trial

  // Cartao state - Checkout Transparente server-side
  const [cartao, setCartao] = useState({
    numero: "",
    validade: "",
    cvv: "",
    nome: "",
    cpfCartao: "",
  });
  const [cartaoLoading, setCartaoLoading] = useState(false);
  const [cartaoErro, setCartaoErro] = useState(null);
  const [cartaoStatus, setCartaoStatus] = useState("idle"); // idle | processando | pending

  // Status do fingerprint do MP (mp-security.js):
  //  - loading: script baixando ou ainda nao populou window.MP_DEVICE_SESSION_ID
  //  - ready:   tem MP_DEVICE_SESSION_ID, pode mostrar formulario
  //  - error:   timeout ou falha, nao da pra processar cartao sem ele
  const [fingerprintStatus, setFingerprintStatus] = useState("loading");

  // PIX trial (acesso free 5min ao copiar PIX)
  const [trialLiberado, setTrialLiberado] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialErro, setTrialErro] = useState(null);

  // Cupom de desconto (o servidor valida e calcula; aqui so mostramos o resultado)
  const [cupomInput, setCupomInput] = useState(() => (searchParams.get("cupom") || "").toUpperCase().slice(0, 32));
  const [cupomAplicado, setCupomAplicado] = useState(null); // { codigo, valor_final, desconto }
  const [cupomMsg, setCupomMsg] = useState(null);
  const [cupomBusy, setCupomBusy] = useState(false);
  // Com cupom vindo no link, o PIX so e gerado depois de validar o cupom (senao sairia com o valor cheio)
  const [cupomResolvido, setCupomResolvido] = useState(() => !(searchParams.get("cupom") || "").trim());

  // Shared state
  const [status, setStatus] = useState("idle");
  const [pagamentoAprovado, setPagamentoAprovado] = useState(false);
  // Acesso pago ja aberto em outro aparelho: aguarda o cliente decidir antes do login final
  const [sessaoAtiva, setSessaoAtiva] = useState(null);
  const [sessaoCancelada, setSessaoCancelada] = useState(false);
  // Acesso gratis (copiar PIX) com o CPF ja conectado em outro aparelho: aguarda a decisao do cliente
  const [sessaoTrial, setSessaoTrial] = useState(null);

  const mac = searchParams.get("mac");
  const ip = searchParams.get("ip");
  const mikrotikId = searchParams.get("mikrotik_id");
  const empresaId = searchParams.get("empresa_id");
  const cpf = searchParams.get("cpf");
  const clienteId = searchParams.get("cliente_id");
  // portal_id explicito (vindo do redirect Login -> Planos -> Pagamento).
  // Necessario pra carregar as configs corretas (PIX/cartao toggles, trial,
  // whatsapp template). Sem ele o backend cai pro mikrotiks.portal_id que e'
  // o portal Login - aplica configs erradas no plano.
  const portalId = searchParams.get("portal_id");

  // Buscar plano
  useEffect(() => {
    const planoUrl = portalId
      ? `/api/planos-publicos/${id}?portal_id=${portalId}`
      : `/api/planos-publicos/${id}`;
    fetch(planoUrl)
      .then((res) => res.json())
      .then((data) => {
        setPlano(data);
        // Auto-seleciona metodo quando so um esta ativo
        const pixOn = data.pagamento_pix_ativo !== false;
        const cartaoOn = data.pagamento_cartao_ativo !== false;
        if (pixOn && !cartaoOn) setMetodo("pix");
        else if (cartaoOn && !pixOn) setMetodo("cartao");
      })
      .catch((err) => console.error("Erro ao carregar plano:", err));
  }, [id, portalId]);

  // Carregar device fingerprint do Mercado Pago.
  // Cria a variavel global window.MP_DEVICE_SESSION_ID que envia ao backend
  // junto com o pagamento. E o maior fator unico de aprovacao do antifraude
  // segundo a doc do MP, e e' a unica forma de ter sinais de seguranca sem
  // usar SDK JS completo / Bricks / CardForm.
  //
  // IMPORTANTE: servimos o script local (/mp-security.js, copia de
  // https://www.mercadopago.com/v2/security.js) porque o walled garden do
  // captive portal so funciona pro primeiro dominio - dominios extras nao
  // pegam hit, entao mercadopago.com seria bloqueado no celular do cliente.
  // O script foi baixado em 2026-04-08 e fica em /frontend/public/mp-security.js.
  // Se ele parar de funcionar, baixar nova versao com:
  //   curl -H 'User-Agent: Mozilla/5.0' 'https://www.mercadopago.com/v2/security.js?view=checkout' \
  //        -o /var/www/hotspot/frontend/public/mp-security.js
  useEffect(() => {
    // Se ja foi populado antes (navegacao interna), libera imediato
    if (typeof window !== "undefined" && window.MP_DEVICE_SESSION_ID) {
      setFingerprintStatus("ready");
      return;
    }

    // Injeta script se ainda nao existe
    if (!document.getElementById("mp-security-js")) {
      const s = document.createElement("script");
      s.id = "mp-security-js";
      s.src = "/mp-security.js";
      s.setAttribute("view", "checkout");
      s.async = true;
      s.onerror = () => setFingerprintStatus("error");
      document.body.appendChild(s);
    }

    // O script popula window.MP_DEVICE_SESSION_ID de forma assincrona
    // (faz POST interno pro /api/pagamentos/mp-device-session proxy).
    // Poll ate 15s aguardando. Se nao aparecer, marca erro (nao da pra
    // processar cartao sem fingerprint — cairia todo em cc_rejected_high_risk).
    const started = Date.now();
    const MAX_WAIT_MS = 15000;
    const interval = setInterval(() => {
      if (typeof window !== "undefined" && window.MP_DEVICE_SESSION_ID) {
        setFingerprintStatus("ready");
        clearInterval(interval);
        return;
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        setFingerprintStatus("error");
        clearInterval(interval);
      }
    }, 300);

    return () => clearInterval(interval);
  }, []);

  const aplicarCupom = async () => {
    const codigo = cupomInput.trim().toUpperCase();
    if (!codigo || !plano) return;
    setCupomBusy(true); setCupomMsg(null);
    try {
      const res = await fetch("/api/cupom-portal/validar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano_id: id, codigo, cpf: cpf || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCupomAplicado(null); setCupomMsg(data.message || data.error || "Cupom inválido ou indisponível."); return; }
      setCupomAplicado({ codigo, valor_final: data.valor_final, desconto: data.desconto });
    } catch {
      setCupomAplicado(null); setCupomMsg("Não foi possível validar o cupom. Tente novamente.");
    } finally {
      setCupomBusy(false);
      setCupomResolvido(true);
    }
  };

  // Cupom que veio no link (ex.: lembrete de renovacao): valida sozinho uma vez, quando o plano carrega
  const cupomAutoTentado = useRef(false);
  useEffect(() => {
    if (cupomAutoTentado.current || !plano || !cupomInput.trim()) return;
    cupomAutoTentado.current = true;
    aplicarCupom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano]);

  const valorExibido = plano ? (cupomAplicado ? cupomAplicado.valor_final : plano.valor) : 0;

  const recarregarFingerprint = () => {
    setFingerprintStatus("loading");
    // Remove script atual pra forcar reload
    const existing = document.getElementById("mp-security-js");
    if (existing) existing.remove();
    if (typeof window !== "undefined") delete window.MP_DEVICE_SESSION_ID;
    // Recria reaproveitando o useEffect via reload forcado
    const s = document.createElement("script");
    s.id = "mp-security-js";
    s.src = "/mp-security.js?t=" + Date.now();
    s.setAttribute("view", "checkout");
    s.async = true;
    s.onerror = () => setFingerprintStatus("error");
    document.body.appendChild(s);
    const started = Date.now();
    const interval = setInterval(() => {
      if (window.MP_DEVICE_SESSION_ID) {
        setFingerprintStatus("ready");
        clearInterval(interval);
      } else if (Date.now() - started > 15000) {
        setFingerprintStatus("error");
        clearInterval(interval);
      }
    }, 300);
  };

  // Gerar pagamento PIX
  useEffect(() => {
    if (metodo !== "pix" || !plano || !cupomResolvido) return;

    // Voltou do login do acesso gratis: retoma o MESMO PIX (nao cria outro pagamento)
    const salvo = lerPixSalvo(id, clienteId);
    if (salvo?.mpPagamentoId && salvo?.copiaCola) {
      setQrCode(salvo.qrCode);
      setCopiaCola(salvo.copiaCola);
      setMpPagamentoId(salvo.mpPagamentoId);
      setPagamentoId(salvo.pagamentoId || null);
      setTrialLiberado(!!salvo.trialLiberado);
      setStatus("gerado");
      return;
    }

    setStatus("gerando");
    fetch("/api/pagamentos/gerar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plano_id: id, mac, ip, cpf, mikrotik_id: mikrotikId, cliente_id: clienteId, portal_id: portalId || null, cupom: cupomAplicado ? cupomAplicado.codigo : undefined }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.message || "Erro ao gerar pagamento");
        setQrCode(data.qr_code_base64);
        setCopiaCola(data.copia_cola);
        setMpPagamentoId(data.mp_pagamento_id);
        setPagamentoId(data.pagamento_id || null);
        setStatus("gerado");
      })
      .catch(() => setStatus("erro"));
  }, [metodo, plano, cupomResolvido]);

  // Se ha um PIX salvo desta aba (voltou do login do acesso gratis), vai direto para ele mesmo quando o
  // portal oferece PIX e cartao (senao a tela de escolha apareceria de novo).
  useEffect(() => {
    if (plano && metodo === null && lerPixSalvo(id, clienteId)?.mpPagamentoId) setMetodo("pix");
  }, [plano]);

  // Acesso gratis assim que o PIX e' gerado: o cliente sai para o app do banco e precisa de internet.
  // Uma tentativa automatica por carregamento; o botao "Copiar" continua como plano B.
  const autoTrialTentado = useRef(false);
  useEffect(() => {
    if (status !== "gerado" || autoTrialTentado.current) return;
    if (!plano?.pix_trial_enabled || trialLiberado || trialLoading || !pagamentoId || !mpPagamentoId) return;
    autoTrialTentado.current = true;
    liberarTrial();
  }, [status, plano, pagamentoId, mpPagamentoId, trialLiberado]);

  // Polling status (PIX e cartao em pending)
  useEffect(() => {
    if (!mpPagamentoId || pagamentoAprovado) return;

    const interval = setInterval(async () => {
      try {
        const url = `/api/pagamentos/status?pagamento_id=${mpPagamentoId}&mac=${encodeURIComponent(mac || "")}&ip=${encodeURIComponent(ip || "")}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === "approved" && data.gateway && data.username) {
          setPagamentoAprovado(true);
          limparPix(id, clienteId);
          if (data.requer_desconexao) { setSessaoAtiva(data); return; }
          // /status devolve a senha real (aleatoria, do radcheck); fallback p/ legado.
          redirecionarHotspot(data.gateway, data.username, data.password || data.username, 2000, data.gateway_info);
        }
      } catch (err) {
        console.error("Erro ao verificar status:", err);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [mpPagamentoId, pagamentoAprovado]);

  const copiarParaClipboard = async () => {
    // 1. Copia o codigo PIX pro clipboard
    try {
      await navigator.clipboard.writeText(copiaCola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch (e) { /* clipboard pode falhar em HTTP, nao bloqueia */ }

    // 2. Se o trial esta ativo e ainda nao foi liberado, dispara agora
    if (plano?.pix_trial_enabled && !trialLiberado && !trialLoading && pagamentoId) {
      await liberarTrial();
    }
  };

  // Acesso gratis ao copiar o PIX. Prova de posse: id interno + id do Mercado Pago + MAC do MESMO pagamento.
  // Se o CPF ja esta conectado em outro aparelho o servidor NAO grava nada e devolve requer_desconexao:
  // o aviso aparece e, depois de desconectar o outro, esta funcao roda de novo.
  const liberarTrial = async () => {
    setTrialLoading(true);
    setTrialErro(null);
    try {
      const res = await fetch("/api/pagamentos/pix-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagamento_id: pagamentoId, mp_pagamento_id: mpPagamentoId, mac }),
      });
      const data = await res.json();
      if (res.status === 409 && data.ja_liberado) {
        // 1 vez por pagamento: ja liberado antes (ex.: voltou do login). Nada a fazer, sem erro.
        setTrialLiberado(true);
      } else if (!res.ok) {
        setTrialErro(data.message || "Nao foi possivel liberar acesso free");
      } else if (data.requer_desconexao) {
        setSessaoTrial(data);
      } else {
        setSessaoTrial(null);
        setTrialLiberado(true);
        // Auto-redireciona pro hotspot login com as creds temporarias
        // para o cliente ter internet e conseguir abrir o app do banco.
        salvarPix(id, clienteId, {
          mpPagamentoId, pagamentoId, qrCode, copiaCola, trialLiberado: true, em: Date.now(),
        });
        if (data.gateway && data.username) {
          setTimeout(() => {
            // voltarPara: o hotspot devolve o cliente a esta pagina (o PIX e' retomado do sessionStorage)
            redirecionarHotspot(data.gateway, data.username, data.password, 1500, data.gateway_info, { voltarPara: window.location.href });
          }, 2000); // 2s pro usuario ler a mensagem antes de redirecionar
        }
      }
    } catch (err) {
      setTrialErro("Erro ao liberar acesso free");
    } finally {
      setTrialLoading(false);
    }
  };

  // Mascaras
  const formatCardNumber = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 19);
    return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  };
  const formatValidade = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 4);
    if (d.length <= 2) return d;
    return `${d.slice(0, 2)}/${d.slice(2)}`;
  };
  const formatCpf = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  };

  const submeterCartao = async (e) => {
    e.preventDefault();
    setCartaoErro(null);

    // Safety net: nao deixa submeter sem fingerprint.
    // A UI ja esconde o form quando fingerprintStatus !== "ready", mas se
    // algo escapar (ex: usuario com extensao bloqueadora), rejeita aqui.
    if (fingerprintStatus !== "ready" || !window.MP_DEVICE_SESSION_ID) {
      setCartaoErro("Ambiente seguro ainda nao carregou. Aguarde alguns segundos e tente novamente.");
      return;
    }

    const numeroDigits = cartao.numero.replace(/\D/g, "");
    const validade = cartao.validade.replace(/\D/g, "");
    const cvvD = cartao.cvv.trim();
    const nomeT = cartao.nome.trim();
    const cpfDigits = cartao.cpfCartao.replace(/\D/g, "");

    if (numeroDigits.length < 13) return setCartaoErro("Numero do cartao invalido.");
    if (validade.length !== 4) return setCartaoErro("Validade invalida (use MM/AA).");
    if (cvvD.length < 3) return setCartaoErro("CVV invalido.");
    if (nomeT.length < 2) return setCartaoErro("Informe o nome no cartao.");
    if (cpfDigits.length !== 11) return setCartaoErro("CPF invalido.");

    const expMonth = validade.slice(0, 2);
    const expYearShort = validade.slice(2, 4);

    setCartaoLoading(true);
    setCartaoStatus("processando");
    // Pega o device fingerprint criado pelo security.js do MP. Pode estar
    // vazio se a pagina acabou de carregar - ainda assim envia (o backend
    // valida e ignora se vazio). E o sinal de seguranca mais importante
    // pro antifraude do MP.
    const deviceSessionId = (typeof window !== "undefined" && window.MP_DEVICE_SESSION_ID) || null;
    try {
      const res = await fetch("/api/pagamentos/gerar-cartao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_number: numeroDigits,
          cardholder_name: nomeT,
          expiration_month: expMonth,
          expiration_year: expYearShort,
          security_code: cvvD,
          identification_number: cpfDigits,
          plano_id: id,
          cupom: cupomAplicado ? cupomAplicado.codigo : undefined,
          mac,
          ip,
          cpf: cpfDigits,
          cliente_id: clienteId,
          device_session_id: deviceSessionId,
          portal_id: portalId || null,
        }),
      });
      const data = await res.json();

      if (data.status === "approved" && data.gateway && data.username) {
        setPagamentoAprovado(true);
        if (data.requer_desconexao) { setSessaoAtiva(data); return; }
        redirecionarHotspot(data.gateway, data.username, data.password, 2000, data.gateway_info);
        return;
      }
      if (data.status === "pending") {
        setMpPagamentoId(data.mp_pagamento_id);
        setCartaoStatus("pending");
        return;
      }
      // rejected ou erro
      setCartaoErro(data.message || "Pagamento recusado.");
      setCartaoStatus("idle");
    } catch (err) {
      console.error("Erro cartao:", err);
      setCartaoErro("Erro ao processar pagamento. Tente novamente.");
      setCartaoStatus("idle");
    } finally {
      setCartaoLoading(false);
    }
  };

  if (pagamentoAprovado && sessaoAtiva) {
    // Data de nascimento informada no cadastro (so na memoria desta aba); se faltar, o aviso pede.
    let dataNasc = "";
    try { dataNasc = sessionStorage.getItem(`hs_dn_${clienteId}`) || ""; } catch { /* sem storage */ }
    return (
      <div className="min-h-screen bg-green-50 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full space-y-4">
          <div className="text-center">
            <div className="text-5xl mb-2">&#10004;</div>
            <h2 className="text-2xl font-bold text-green-700">Pagamento Aprovado!</h2>
          </div>
          {sessaoCancelada ? (
            <div className="text-sm text-gray-700 space-y-3">
              <p>Seu acesso está liberado, mas continua conectado no outro aparelho. Quando ele desconectar, você poderá conectar aqui.</p>
              <button type="button" onClick={() => setSessaoCancelada(false)} className="px-4 py-2.5 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">
                Desconectar o outro e conectar aqui
              </button>
            </div>
          ) : (
            <SessaoAtivaAviso
              dados={sessaoAtiva}
              cpf={sessaoAtiva.username}
              dataNascimento={dataNasc}
              mac={mac}
              mikrotikId={mikrotikId}
              onCancelar={() => setSessaoCancelada(true)}
            />
          )}
        </div>
      </div>
    );
  }

  if (pagamentoAprovado) {
    return (
      <div className="min-h-screen bg-green-50 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-md">
          <div className="text-5xl mb-4">&#10004;</div>
          <h2 className="text-2xl font-bold text-green-700 mb-2">Pagamento Aprovado!</h2>
          <p className="text-gray-600">Conectando voce a internet...</p>
          <div className="mt-4 animate-pulse text-sm text-gray-400">Redirecionando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-800 mb-4">Pagamento do Plano</h1>

      {sessaoTrial && (
        <div className="w-full max-w-md mb-4">
          <SessaoAtivaAviso
            dados={sessaoTrial}
            cpf={sessaoTrial.username}
            dataNascimento={(() => { try { return sessionStorage.getItem(`hs_dn_${clienteId}`) || ""; } catch { return ""; } })()}
            mac={mac}
            mikrotikId={mikrotikId}
            aoDesconectar={liberarTrial}
            onCancelar={() => setSessaoTrial(null)}
          />
        </div>
      )}

      {mac && (
        <p className="mb-2 text-sm text-gray-500">
          Dispositivo: <span className="font-mono">{mac}</span> IP: <span className="font-mono">{ip}</span>
        </p>
      )}

      {plano && (
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold">{plano.nome}</h2>
          {cupomAplicado ? (
            <p className="text-gray-600"><span className="line-through text-gray-400 mr-2">R$ {(plano.valor / 100).toFixed(2)}</span><span className="font-semibold text-green-700">R$ {(valorExibido / 100).toFixed(2)}</span></p>
          ) : (
            <p className="text-gray-600">R$ {(plano.valor / 100).toFixed(2)}</p>
          )}
        </div>
      )}

      {/* Escolha de metodo */}
      {metodo === null && plano && (
        <div className="w-full max-w-md space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <label htmlFor="cupom" className="block text-sm text-gray-600 mb-1">Tem cupom de desconto?</label>
            <div className="flex gap-2">
              <input id="cupom" value={cupomInput} onChange={(e) => { setCupomInput(e.target.value.toUpperCase().replace(/\s/g, "")); setCupomAplicado(null); setCupomMsg(null); }}
                maxLength={32} autoCapitalize="characters" placeholder="Digite o código" className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-gray-800" />
              <button type="button" onClick={aplicarCupom} disabled={cupomBusy || !cupomInput.trim()} className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm disabled:opacity-50">{cupomBusy ? "..." : "Aplicar"}</button>
            </div>
            {cupomAplicado && <p className="text-sm text-green-700 mt-1">Cupom aplicado! Você economiza R$ {(cupomAplicado.desconto / 100).toFixed(2).replace(".", ",")}.</p>}
            {cupomMsg && <p className="text-sm text-red-600 mt-1">{cupomMsg}</p>}
          </div>

          <p className="text-center text-gray-600 mb-4">Escolha a forma de pagamento:</p>

          {plano.pagamento_pix_ativo !== false && (
            <button
              onClick={() => setMetodo("pix")}
              className="w-full bg-white border-2 border-gray-200 hover:border-green-500 rounded-xl p-5 flex items-center gap-4 transition-all shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg width="28" height="28" viewBox="0 0 512 512" fill="none">
                  <path d="M382.56 233.38L304.24 311.7a42.49 42.49 0 01-60.12 0l-79.44-79.44a42.49 42.49 0 00-60.12 0l-67.94 67.95 49.66 49.65a116.4 116.4 0 00164.58 0l87.28-87.28 87.28 87.28a116.4 116.4 0 00164.58 0l49.65-49.65-67.93-67.95a42.49 42.49 0 00-60.12 0l-79.44 79.44a42.49 42.49 0 01-60.12 0L293.12 233.38a42.49 42.49 0 00-60.12 0" fill="#32BCAD" transform="scale(0.7) translate(100, 100)"/>
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold text-gray-800 text-lg">PIX</div>
                <div className="text-sm text-gray-500">Pagamento instantaneo via QR Code</div>
              </div>
            </button>
          )}

          {plano.pagamento_cartao_ativo !== false && (
            <button
              onClick={() => setMetodo("cartao")}
              className="w-full bg-white border-2 border-gray-200 hover:border-blue-500 rounded-xl p-5 flex items-center gap-4 transition-all shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold text-gray-800 text-lg">Cartao de Credito</div>
                <div className="text-sm text-gray-500">Pagamento com aprovacao instantanea</div>
              </div>
            </button>
          )}

          <button
            onClick={() => window.history.back()}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-4"
          >
            Voltar
          </button>
        </div>
      )}

      {/* PIX */}
      {metodo === "pix" && (
        <>
          {status === "gerando" && <p className="text-gray-500">Gerando pagamento...</p>}
          {status === "erro" && <p className="text-red-500">Erro ao gerar pagamento.</p>}
          {status === "gerado" && <p className="text-sm text-gray-600 mb-4">Aguardando pagamento...</p>}

          {qrCode && (
            <>
              <img
                src={`data:image/png;base64,${qrCode}`}
                alt="QR Code"
                className="mb-4 w-64 h-64 shadow-lg border border-gray-300"
              />
              <div className="w-full max-w-md mb-4">
                <textarea
                  readOnly
                  value={copiaCola}
                  className="w-full p-3 border border-gray-300 rounded mb-2 resize-none"
                  rows={4}
                />

                {/* Info box do trial 5min - so aparece se ativado no portal e ainda nao liberou */}
                {plano?.pix_trial_enabled && !trialLiberado && (
                  <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                      </svg>
                      <div className="text-xs text-emerald-900 leading-relaxed">
                        <strong>Internet liberada por {plano.pix_trial_duracao_minutos || 5} minutos!</strong> Assim que o
                        codigo Pix e gerado voce recebe internet temporaria (uma unica vez por pagamento)
                        para abrir o app do seu banco e efetuar o pagamento.
                        <br/><br/>
                        Assim que o pagamento for aprovado voce recebera o <strong>usuario e senha
                        no WhatsApp</strong>.
                        <br/><br/>
                        <em>⚠️ Nao esqueca de desconectar e reconectar no WiFi apos o pagamento para fazer login com as novas credenciais.</em>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mensagem de sucesso apos liberar o trial */}
                {trialLiberado && (
                  <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <div className="text-xs text-green-900 leading-relaxed">
                        <strong>Internet liberada!</strong> Abra o app do seu banco e cole o codigo PIX para pagar.
                        <br/>
                        Voce sera redirecionado em alguns segundos...
                      </div>
                    </div>
                  </div>
                )}

                {/* Erro ao liberar trial */}
                {trialErro && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="text-xs text-red-800">
                      <strong>Nao foi possivel liberar acesso free:</strong> {trialErro}
                    </div>
                  </div>
                )}

                <button
                  onClick={copiarParaClipboard}
                  disabled={trialLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded"
                >
                  {trialLoading ? "Liberando acesso..." : copiado ? "Copiado!" : "Copiar codigo Pix"}
                </button>
              </div>
              <p className="text-sm text-gray-600 text-center">
                Escaneie o QR Code ou copie o codigo acima para pagar via Pix.
              </p>
            </>
          )}

          <button
            onClick={() => { setMetodo(null); setStatus("idle"); setQrCode(null); setMpPagamentoId(null); }}
            className="mt-6 text-sm text-gray-400 hover:text-gray-600"
          >
            Trocar forma de pagamento
          </button>
        </>
      )}

      {/* Cartao - carregando fingerprint MP (seguranca antifraude) */}
      {metodo === "cartao" && cartaoStatus !== "pending" && fingerprintStatus === "loading" && (
        <div className="w-full max-w-md bg-white rounded-lg p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600 mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Preparando ambiente seguro</h3>
          <p className="text-sm text-gray-600">
            Estamos carregando os módulos de segurança do Mercado Pago.
            Isso leva alguns segundos.
          </p>
        </div>
      )}

      {metodo === "cartao" && cartaoStatus !== "pending" && fingerprintStatus === "error" && (
        <div className="w-full max-w-md bg-white rounded-lg p-6 text-center border-2 border-red-200">
          <div className="w-12 h-12 mx-auto mb-3 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Módulo de segurança não carregou</h3>
          <p className="text-sm text-gray-600 mb-4">
            Não foi possível carregar o ambiente seguro do Mercado Pago. Isso é necessário
            para processar o cartão com segurança.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={recarregarFingerprint}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm"
            >
              Tentar novamente
            </button>
            {plano?.pagamento_pix_ativo !== false && (
              <button
                type="button"
                onClick={() => setMetodo("pix")}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg font-medium text-sm"
              >
                Usar PIX
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cartao - Checkout Transparente */}
      {metodo === "cartao" && cartaoStatus !== "pending" && fingerprintStatus === "ready" && (
        <form onSubmit={submeterCartao} className="w-full max-w-md space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Numero do cartao</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              value={cartao.numero}
              onChange={(e) => setCartao({ ...cartao, numero: formatCardNumber(e.target.value) })}
              placeholder="0000 0000 0000 0000"
              className="w-full p-3 border border-gray-300 rounded-lg font-mono"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Validade</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp"
                value={cartao.validade}
                onChange={(e) => setCartao({ ...cartao, validade: formatValidade(e.target.value) })}
                placeholder="MM/AA"
                className="w-full p-3 border border-gray-300 rounded-lg font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="cc-csc"
                value={cartao.cvv}
                onChange={(e) => setCartao({ ...cartao, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder="123"
                className="w-full p-3 border border-gray-300 rounded-lg font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome impresso no cartao</label>
            <input
              type="text"
              autoComplete="cc-name"
              value={cartao.nome}
              onChange={(e) => setCartao({ ...cartao, nome: e.target.value.toUpperCase() })}
              placeholder="NOME COMO NO CARTAO"
              className="w-full p-3 border border-gray-300 rounded-lg uppercase"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CPF do titular</label>
            <input
              type="text"
              inputMode="numeric"
              value={cartao.cpfCartao}
              onChange={(e) => setCartao({ ...cartao, cpfCartao: formatCpf(e.target.value) })}
              placeholder="000.000.000-00"
              className="w-full p-3 border border-gray-300 rounded-lg font-mono"
              required
            />
          </div>

          {cartaoErro && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {cartaoErro}
            </div>
          )}

          <button
            type="submit"
            disabled={cartaoLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50"
          >
            {cartaoLoading ? "Processando..." : (plano ? `Pagar R$ ${(valorExibido / 100).toFixed(2).replace(".", ",")}` : "Pagar")}
          </button>

          <button
            type="button"
            onClick={() => { setMetodo(null); setCartaoErro(null); }}
            className="w-full text-sm text-gray-400 hover:text-gray-600"
          >
            Trocar forma de pagamento
          </button>

          <p className="text-xs text-gray-400 text-center mt-2">
            Pagamento processado com seguranca pelo Mercado Pago.
          </p>
        </form>
      )}

      {/* Cartao - aguardando aprovacao final (in_process) */}
      {metodo === "cartao" && cartaoStatus === "pending" && (
        <div className="w-full max-w-md text-center">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <div className="animate-spin w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-3"></div>
            <p className="font-semibold text-blue-800">Confirmando seu pagamento...</p>
            <p className="text-sm text-blue-600 mt-1">Aguarde, isso pode levar alguns segundos.</p>
          </div>
        </div>
      )}
    </div>
  );
}
