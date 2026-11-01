import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import GatewayWizard from "../../components/admin/GatewayWizard";
import TrilhaAtivacao, { progresso } from "../../components/admin/TrilhaAtivacao";
import AlertasEquipamentos from "../../components/admin/AlertasEquipamentos";

// Badges por tipo de gateway (default mikrotik pra linhas antigas sem tipo)
const TIPO_BADGES = {
  mikrotik: { label: "MikroTik", cls: "bg-sky-900/30 border-sky-800/50 text-sky-400" },
  omada: { label: "Omada", cls: "bg-emerald-900/30 border-emerald-800/50 text-emerald-400" },
  unifi: { label: "UniFi", cls: "bg-indigo-900/30 border-indigo-800/50 text-indigo-400" },
  grandstream: { label: "Grandstream", cls: "bg-rose-900/30 border-rose-800/50 text-rose-400" },
  intelbras: { label: "Intelbras", cls: "bg-teal-900/30 border-teal-800/50 text-teal-400" },
};

export default function Mikrotiks() {
  const [mikrotiks, setMikrotiks] = useState([]);
  const [portais, setPortais] = useState([]);
  const [showGwWizard, setShowGwWizard] = useState(false);
  const [editandoGw, setEditandoGw] = useState(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [hotspotLog, setHotspotLog] = useState([]);
  const [enviandoHotspot, setEnviandoHotspot] = useState(null);
  const [diag, setDiag] = useState(null); // { id, nome, carregando, dados, erro, corrigindo, msg }
  const [enviandoLogin, setEnviandoLogin] = useState(null);
  const [enviandoStatus, setEnviandoStatus] = useState(null);
  const [mikrotikInfo, setMikrotikInfo] = useState(null);
  const [erro, setErro] = useState("");
  const [aplicandoPadroes, setAplicandoPadroes] = useState(false);
  const [showAlertas, setShowAlertas] = useState(false);
  const [resultadoPadroes, setResultadoPadroes] = useState(null); // [{id, nome, ok, mensagem}]
  const [trilhas, setTrilhas] = useState({}); // { [id]: { etapas, concluidas, total } }
  const [trilhaAberta, setTrilhaAberta] = useState(null);

  // API do controller Omada (captura de nomes de APs — o portal segue 100% RADIUS)
  const [apiGw, setApiGw] = useState(null); // gateway do modal aberto (null = fechado)
  const [apiForm, setApiForm] = useState({ controller_url: "", api_user: "", api_pass: "", verify_tls: 0 });
  const [apiBusy, setApiBusy] = useState(false);
  const [apiMsg, setApiMsg] = useState(null); // { ok, texto, aps? }

  const token = localStorage.getItem("admin_token");

  const abrirApiOmada = (m) => {
    setApiGw(m);
    setApiMsg(null);
    setApiForm({
      controller_url: m.controller_url || `https://${m.ip}`,
      api_user: m.api_user || "",
      api_pass: "",
      verify_tls: Number(m.verify_tls) || 0,
    });
  };

  const salvarApiOmada = async () => {
    if (!apiForm.controller_url || !apiForm.api_user || !apiForm.api_pass) {
      setApiMsg({ ok: false, texto: "Preencha URL do controller, usuário e senha do admin local." });
      return;
    }
    setApiBusy(true);
    setApiMsg(null);
    try {
      const res = await fetch(`/api/mikrotiks/${apiGw.id}/omada-api`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(apiForm),
      });
      const data = await res.json();
      setApiMsg({ ok: res.ok, texto: data.message, aps: data.aps });
      if (res.ok) carregarMikrotiks();
    } catch {
      setApiMsg({ ok: false, texto: "Erro de conexão com o servidor." });
    } finally {
      setApiBusy(false);
    }
  };

  const sincronizarApsAgora = async () => {
    setApiBusy(true);
    setApiMsg(null);
    try {
      const res = await fetch(`/api/mikrotiks/${apiGw.id}/sincronizar-aps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setApiMsg({ ok: res.ok, texto: data.message, aps: data.aps });
    } catch {
      setApiMsg({ ok: false, texto: "Erro de conexão com o servidor." });
    } finally {
      setApiBusy(false);
    }
  };

  const removerApiOmada = async () => {
    if (!confirm("Remover a configuração da API deste gateway? Os nomes de APs já importados serão mantidos.")) return;
    setApiBusy(true);
    try {
      const res = await fetch(`/api/mikrotiks/${apiGw.id}/omada-api`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setApiMsg({ ok: res.ok, texto: data.message });
      if (res.ok) { carregarMikrotiks(); setApiForm((f) => ({ ...f, api_user: "", api_pass: "" })); }
    } catch {
      setApiMsg({ ok: false, texto: "Erro de conexão com o servidor." });
    } finally {
      setApiBusy(false);
    }
  };

  const carregarPortais = async () => {
    try {
      const res = await fetch("/api/portais", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setPortais(data);
    } catch (err) { console.error(err); }
  };

  // Wizard states
  // Vazio = o hotspot usa o IP do gateway. Um nome de exemplo que nao resolve na internet derrubava o login final (caso RB09).
  const DNS_NAME_PADRAO = "";
  const PRESETS_REDE = [
    { id: "p24", rotulo: "Pequena — /24 (~250 clientes)", localAddress: "10.5.50.1/24", poolRange: "10.5.50.2-10.5.50.254" },
    { id: "p23", rotulo: "Média — /23 (~500 clientes)", localAddress: "10.5.50.1/23", poolRange: "10.5.50.2-10.5.51.254" },
    { id: "p22", rotulo: "Grande — /22 (~1000 clientes, eventos)", localAddress: "10.5.48.1/22", poolRange: "10.5.48.2-10.5.51.254" },
  ];
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardMikrotikId, setWizardMikrotikId] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [wizardConfig, setWizardConfig] = useState({
    interface: "", localAddress: "10.5.50.1/24", poolName: "hs-pool", poolRange: "10.5.50.2-10.5.50.254", dnsName: DNS_NAME_PADRAO, wifiSsid: "", dnsSeguro: "", onLogout: "", blockRedirect: "", logConexoes: "", criarBridge: false, portasBridge: []
  });

  const abrirWizard = async (id) => {
    setWizardMikrotikId(id);
    setScanning(true);
    setScanData(null);
    setShowWizard(true);
    setWizardStep(0);
    setWizardConfig({ interface: "", localAddress: "10.5.50.1/24", poolName: "hs-pool", poolRange: "10.5.50.2-10.5.50.254", dnsName: DNS_NAME_PADRAO, wifiSsid: "", dnsSeguro: "", onLogout: "", blockRedirect: "", logConexoes: "", criarBridge: false, portasBridge: [] });

    try {
      const res = await fetch(`/api/mikrotiks/${id}/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message); setShowWizard(false); return; }
      setScanData(data);
      if (data.interfaces?.length > 0) {
        const livre = data.interfaces.find(i => !i.wan && !i.bridge && !i.tunel && i.disabled !== "true" && /^(ether|wlan|wifi)/.test(i.name));
        setWizardConfig(c => ({ ...c, interface: livre?.name || "" }));
      }
      if (data.pools?.length > 0) {
        setWizardConfig(c => ({ ...c, poolName: data.pools[0].name, poolRange: data.pools[0].ranges }));
      }
    } catch (err) {
      alert("Erro ao escanear Mikrotik");
      setShowWizard(false);
    } finally {
      setScanning(false);
    }
  };

  const executarWizard = async () => {
    setEnviandoHotspot(wizardMikrotikId);
    setShowWizard(false);
    setHotspotLog([]);
    setShowLogModal(true);

    try {
      const res = await fetch(`/api/mikrotiks/${wizardMikrotikId}/enviar-hotspot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...wizardConfig,
          dnsSeguro: wizardConfig.dnsSeguro === "ligar" ? true : wizardConfig.dnsSeguro === "desligar" ? false : undefined,
          onLogout: wizardConfig.onLogout === "ligar" ? true : wizardConfig.onLogout === "desligar" ? false : undefined,
          blockRedirect: wizardConfig.blockRedirect === "ligar" ? true : wizardConfig.blockRedirect === "desligar" ? false : undefined,
          logConexoes: wizardConfig.logConexoes === "ligar" ? true : wizardConfig.logConexoes === "desligar" ? false : undefined,
          criarBridge: wizardConfig.criarBridge === true,
          portasBridge: wizardConfig.criarBridge ? wizardConfig.portasBridge : [],
        }),
      });

      if (!res.ok) {
        const falha = await res.json().catch(() => ({}));
        setHotspotLog([`[erro] ${falha.message || "Não foi possível iniciar o assistente."}`]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalizou = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "step") {
              setHotspotLog(prev => [...prev, `[${event.status}] ${event.message}`]);
            } else if (event.type === "error") {
              setHotspotLog(prev => [...prev, `[erro] ${event.message}`]);
            } else if (event.type === "done") {
              finalizou = true;
              setHotspotLog(prev => {
                if (!event.success) return [...prev, "--- O assistente terminou com ERRO. NÃO considere o hotspot pronto: veja as linhas [erro] acima. ---"];
                if (prev.some(l => l.startsWith("[aviso]"))) return [...prev, "--- Terminou com AVISOS: confira as linhas [aviso] acima e use 'Diagnosticar' na linha do equipamento. ---"];
                return [...prev, "--- Configuracao finalizada com sucesso! ---"];
              });
              carregarMikrotiks();
            }
          } catch (e) { /* parse error, ignora */ }
        }
      }
      if (!finalizou) {
        setHotspotLog(prev => [...prev, "[aviso] A conexao com o servidor foi encerrada antes do fim. O roteador pode ter sido configurado: confira e, se preciso, use 'Aplicar padroes em todos'."]);
      }
    } catch (err) {
      setHotspotLog(prev => [...prev, `[aviso] Conexao com o servidor caiu (${err.message}). O roteador pode ter sido configurado: confira e, se preciso, use 'Aplicar padroes em todos'.`]);
    } finally {
      setEnviandoHotspot(null);
    }
  };

const diagnosticar = async (m) => {
  setDiag({ id: m.id, nome: m.nome, carregando: true, dados: null, erro: "", corrigindo: null, msg: "" });
  try {
    const res = await fetch(`/api/mikrotiks/${m.id}/diagnostico-hotspot`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Falha ao diagnosticar");
    setDiag(d => d && d.id === m.id ? { ...d, carregando: false, dados: data } : d);
  } catch (e) {
    setDiag(d => d && d.id === m.id ? { ...d, carregando: false, erro: e.message } : d);
  }
};

const corrigirDiag = async (acao, texto) => {
  if (!diag || !window.confirm(`${texto}?\n\nIsso altera o roteador agora.`)) return;
  setDiag(d => ({ ...d, corrigindo: acao, msg: "" }));
  try {
    const res = await fetch(`/api/mikrotiks/${diag.id}/corrigir-hotspot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Falha ao corrigir");
    setDiag(d => ({ ...d, corrigindo: null, msg: data.message }));
    carregarMikrotiks();
    diagnosticar({ id: diag.id, nome: diag.nome });
  } catch (e) {
    setDiag(d => ({ ...d, corrigindo: null, erro: e.message }));
  }
};

const carregarTrilhas = async () => {
  try {
    const res = await fetch("/api/mikrotiks/trilha", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setTrilhas((await res.json()).data || {});
  } catch { /* trilha e' complementar: a tela segue sem ela */ }
};

const carregarMikrotiks = async (abrirMaisNovo = false) => {
  carregarTrilhas();
  try {
    const res = await fetch("/api/mikrotiks", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    // Inicia todos com status "loading"
    const mikrotiksComStatus = data.map(m => ({ ...m, status: "loading" }));
    if (abrirMaisNovo && data.length) setTrilhaAberta(Math.max(...data.map(m => m.id)));
    setMikrotiks(mikrotiksComStatus);

    // Testa conexão de cada Mikrotik
    for (const m of data) {
      try {
        const res = await fetch(`/api/mikrotiks/${m.id}/testar`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        const result = await res.json();
        setMikrotiks(prev => prev.map(item =>
          item.id === m.id
            ? { ...item, status: res.ok ? "online" : "offline" }
            : item
        ));
      } catch {
        setMikrotiks(prev => prev.map(item =>
          item.id === m.id
            ? { ...item, status: "offline" }
            : item
        ));
      }
    }
  } catch (err) {
    setErro("Erro ao buscar Mikrotiks");
  }
};
  const editar = (mikrotik) => {
    setEditandoGw(mikrotik);
    setShowGwWizard(true);
  };

  const remover = async (id) => {
    if (!confirm("Deseja realmente remover este Mikrotik?")) return;
    try {
      await fetch(`/api/mikrotiks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      carregarMikrotiks();
    } catch {
      alert("Erro ao deletar Mikrotik");
    }
  };

  const testarConexao = async (id) => {
    try {
      const res = await fetch(`/api/mikrotiks/${id}/testar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setMikrotiks(prev => prev.map(i => i.id === id ? { ...i, status: res.ok ? "online" : "offline" } : i));

      if (res.ok) {
        alert("✅ Conexão bem-sucedida com o Mikrotik.");
      } else {
        alert(`❌ Falha: ${data.message || "Sem detalhe do servidor"}`);
      }
    } catch {
      alert("Erro ao testar conexão");
    }
  };

  const abrirInfo = async (id) => {
    try {
      const res = await fetch(`/api/mikrotiks/${id}/info`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setMikrotikInfo(data);
        setShowInfoModal(true);
      } else {
        alert(`Erro ao obter informações: ${data.message}`);
      }
    } catch {
      alert("Erro ao conectar ao Mikrotik");
    }
  };

  const enviarLogin = async (id) => {
    setEnviandoLogin(id);
    try {
      const res = await fetch(`/api/mikrotiks/${id}/enviar-login`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      alert(data.message);
    } catch {
      alert("Erro de conexão ao enviar login.html");
    } finally {
      setEnviandoLogin(null);
    }
  };

  const enviarStatus = async (id) => {
    setEnviandoStatus(id);
    try {
      const res = await fetch(`/api/mikrotiks/${id}/enviar-status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      alert(data.message);
    } catch {
      alert("Erro de conexão ao enviar status.html");
    } finally {
      setEnviandoStatus(null);
    }
  };

  // Aplica os padroes do hotspot (keepalive 30 min, interim-update 5m, timeout RADIUS 3s) em todos os MikroTik
  const aplicarPadroesEmTodos = async () => {
    if (!confirm("Aplicar os padrões do hotspot (keepalive 30 min, atualização RADIUS a cada 5 min, timeout RADIUS 3s) em TODOS os equipamentos MikroTik desta empresa?")) return;
    setAplicandoPadroes(true);
    setResultadoPadroes(null);
    try {
      const res = await fetch("/api/mikrotiks/aplicar-padroes", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao aplicar os padrões");
      setResultadoPadroes(data.resultados || []);
    } catch (err) {
      setResultadoPadroes([{ id: 0, nome: "Erro", ok: false, mensagem: err.message }]);
    } finally {
      setAplicandoPadroes(false);
    }
  };

  useEffect(() => {
    carregarMikrotiks();
    carregarPortais();
  }, []);

  const botaoTrilha = (m) => {
    const t = trilhas[m.id];
    if (!t) return null;
    const { ok, total, completo } = progresso(t, m.status);
    return (
      <button
        onClick={() => setTrilhaAberta(trilhaAberta === m.id ? null : m.id)}
        className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer ${completo ? "border-green-700 text-green-400" : "border-amber-600/70 text-amber-400"}`}
        title="Trilha de ativação do equipamento"
      >
        {completo ? "✓ Ativo" : `Trilha ${ok}/${total}`}
      </button>
    );
  };

  const renderTrilha = (m) => (
    <TrilhaAtivacao
      trilha={trilhas[m.id]}
      status={m.status}
      onTestar={() => testarConexao(m.id)}
      onHotspot={() => abrirWizard(m.id)}
      onEditar={() => editar(m)}
    />
  );

  const renderAcoes = (m) => {
    const isMikrotik = !m.tipo || m.tipo === "mikrotik";
    return (
        <div className="flex flex-wrap gap-1.5">
          <span className="hidden md:inline-flex">{botaoTrilha(m)}</span>
          {isMikrotik && (
            <>
              <button onClick={() => abrirWizard(m.id)} title="Enviar Hotspot" className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${enviandoHotspot === m.id ? 'bg-yellow-600 text-white animate-pulse' : 'bg-blue-600 text-white hover:bg-blue-500'}`} disabled={enviandoHotspot === m.id}>
                {enviandoHotspot === m.id ? "Enviando..." : "Hotspot"}
              </button>
              <button onClick={() => diagnosticar(m)} title="Diagnosticar o hotspot (so leitura)" className="px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer border border-amber-700/60 text-amber-400 hover:bg-amber-900/20">
                Diagnosticar
              </button>
              <button onClick={() => enviarLogin(m.id)} title="Enviar login.html" className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${enviandoLogin === m.id ? 'bg-yellow-600 text-white animate-pulse' : 'bg-green-700 text-white hover:bg-green-600'}`} disabled={enviandoLogin === m.id}>
                {enviandoLogin === m.id ? "Enviando..." : "Login"}
              </button>
              <button onClick={() => enviarStatus(m.id)} title="Enviar status.html" className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${enviandoStatus === m.id ? 'bg-yellow-600 text-white animate-pulse' : 'bg-teal-700 text-white hover:bg-teal-600'}`} disabled={enviandoStatus === m.id}>
                {enviandoStatus === m.id ? "Enviando..." : "Status"}
              </button>
            </>
          )}
          {m.tipo === "omada" && (
            <button onClick={() => abrirApiOmada(m)} title="API do controller (captura de nomes de APs)"
              className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${m.controller_url ? "bg-purple-700 text-white hover:bg-purple-600" : "border border-purple-800/60 text-purple-400 hover:bg-purple-900/20"}`}>
              API
            </button>
          )}
          <button onClick={() => testarConexao(m.id)} title="Testar" className="border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs hover:bg-[#252b3b] cursor-pointer">Testar</button>
          {isMikrotik && (
            <button onClick={() => abrirInfo(m.id)} title="Info" className="border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs hover:bg-[#252b3b] cursor-pointer">Info</button>
          )}
          <button onClick={() => editar(m)} title="Editar" className="border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs hover:bg-[#252b3b] cursor-pointer">Editar</button>
          <button onClick={() => remover(m.id)} title="Remover" className="border border-red-800/50 text-red-400 px-2 py-1 rounded text-xs hover:bg-red-900/20 cursor-pointer">Remover</button>
        </div>
    );
  };

  return (
    <AdminLayout>
      {showAlertas && <AlertasEquipamentos onFechar={() => setShowAlertas(false)} />}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Equipamentos</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={aplicarPadroesEmTodos}
            disabled={aplicandoPadroes}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded shadow disabled:opacity-50 w-full sm:w-auto"
            title="Keepalive 30 min, atualização RADIUS a cada 5 min e timeout RADIUS 3s em todos os MikroTik"
          >
            {aplicandoPadroes ? "Aplicando..." : "Aplicar padrões em todos"}
          </button>
          <button
            onClick={() => setShowAlertas(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded shadow w-full sm:w-auto"
            title="Aviso por WhatsApp quando um equipamento ficar offline"
          >
            Alertas offline
          </button>
          <button
            onClick={() => { setEditandoGw(null); setShowGwWizard(true); }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded shadow"
          >
            + Adicionar Equipamento
          </button>
        </div>
      </div>

      {mikrotiks.length > 0 && Object.keys(trilhas).length > 0 && (() => {
        const info = mikrotiks.map((m) => ({ m, ...progresso(trilhas[m.id], m.status) })).filter((x) => trilhas[x.m.id]);
        const ativos = info.filter((x) => x.completo).length;
        const pend = info.filter((x) => !x.completo);
        return (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-white">Ativação dos equipamentos</h3>
              <span className="text-sm text-gray-400">{ativos} de {info.length} ativos</span>
            </div>
            {pend.length === 0 ? (
              <p className="text-sm text-green-400 mt-2">Todos os equipamentos estão ativos.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {pend.map(({ m, ok, total }) => {
                  const prox = trilhas[m.id].etapas.find((e) => e.estado === "pendente" && e.chave !== "conectividade") || trilhas[m.id].etapas.find((e) => e.estado === "pendente");
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-2">
                      <button onClick={() => setTrilhaAberta(m.id)} className="text-blue-400 hover:underline text-left cursor-pointer">{m.nome}</button>
                      <span className="text-gray-500">{ok}/{total}</span>
                      {prox && <span className="text-amber-400">Próximo: {prox.titulo}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}

      {resultadoPadroes && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 mb-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-white">Resultado da aplicação dos padrões</h3>
            <button onClick={() => setResultadoPadroes(null)} className="text-gray-400 hover:text-white text-sm">Fechar</button>
          </div>
          {resultadoPadroes.length === 0 && <p className="text-gray-400 text-sm">Nenhum equipamento MikroTik cadastrado.</p>}
          <ul className="space-y-1 text-sm">
            {resultadoPadroes.map((r) => (
              <li key={`${r.id}-${r.nome}`} className={r.ok ? "text-green-400" : "text-red-400"}>
                {r.ok ? "✔" : "✖"} {r.nome}: {r.mensagem}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 md:p-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <span className="text-gray-300">📶</span> Equipamentos Cadastrados
        </h2>
        {erro && <p className="text-red-600 mb-4">{erro}</p>}
        <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500 border-b border-gray-800">
            <tr>
              <th className="p-2">Nome</th>
              <th className="p-2">Tipo</th>
              <th className="p-2">IP</th>
              <th className="p-2">Portal</th>
              <th className="p-2">Status</th>
              <th className="p-2">Usuários Ativos</th>
              <th className="p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {mikrotiks.map((m) => {
              const badge = TIPO_BADGES[m.tipo] || TIPO_BADGES.mikrotik;
              const isMikrotik = !m.tipo || m.tipo === "mikrotik";
              return (
              <React.Fragment key={m.id}>
              <tr className="border-b hover:bg-[#151821]">
                <td className="p-2 font-medium text-white">{m.nome}</td>
                <td className="p-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                </td>
                <td className="p-2">{m.ip}</td>
                <td className="p-2">
                  {m.portal_nome ? (
                    <span className="text-xs px-2 py-0.5 rounded border border-blue-800/50 bg-blue-900/20 text-blue-400">{m.portal_nome}</span>
                  ) : (
                    <span className="text-xs text-gray-500">Nenhum</span>
                  )}
                </td>
                <td className="p-2">
                  {m.status === "loading" ? (
                    <span className="text-gray-500 text-xs">Verificando...</span>
                  ) : (
                    <span className={`text-xs px-3 py-1 rounded-full text-white ${m.status === "online" ? "bg-green-600" : "bg-red-600"}`}>
                      {m.status === "online" ? "Online" : "Offline"}
                    </span>
                  )}
                </td>
                <td className="p-2">{trilhas[m.id]?.usuarios_ativos ?? m.usuarios_ativos ?? 0}</td>
                <td className="p-2">
                  {renderAcoes(m)}
                </td>
              </tr>
              {trilhaAberta === m.id && (
                <tr className="border-b">
                  <td colSpan={7} className="p-3">{renderTrilha(m)}</td>
                </tr>
              )}
              </React.Fragment>
            );})}
          </tbody>
        </table>
        </div>
        <div className="md:hidden space-y-3">
          {mikrotiks.map((m) => {
            const badge = TIPO_BADGES[m.tipo] || TIPO_BADGES.mikrotik;
            return (
              <div key={m.id} className="bg-[#151821] border border-gray-800 rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-white break-words min-w-0">{m.nome}</span>
                  {m.status === "loading" ? (
                    <span className="text-gray-500 text-xs shrink-0">Verificando...</span>
                  ) : (
                    <span className={`text-xs px-3 py-1 rounded-full text-white shrink-0 ${m.status === "online" ? "bg-green-600" : "bg-red-600"}`}>
                      {m.status === "online" ? "Online" : "Offline"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <span className={`px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                  <span>{m.ip}</span>
                  {m.portal_nome ? (
                    <span className="px-2 py-0.5 rounded border border-blue-800/50 bg-blue-900/20 text-blue-400">{m.portal_nome}</span>
                  ) : (
                    <span className="text-gray-500">Sem portal</span>
                  )}
                  <span>Usuários ativos: {trilhas[m.id]?.usuarios_ativos ?? m.usuarios_ativos ?? 0}</span>
                </div>
                {botaoTrilha(m)}
                {trilhaAberta === m.id && renderTrilha(m)}
                {renderAcoes(m)}
              </div>
            );
          })}
        </div>
      </div>

      {showInfoModal && mikrotikInfo && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Informações do Mikrotik</h3>
              <button onClick={() => setShowInfoModal(false)} className="text-gray-500 hover:text-gray-300">×</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#0d1117] p-4 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500">Modelo</p>
                <p className="font-medium">{mikrotikInfo.modelo}</p>
              </div>
              <div className="bg-[#0d1117] p-4 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500">Versão</p>
                <p className="font-medium">{mikrotikInfo.versao}</p>
              </div>
              <div className="bg-[#0d1117] p-4 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500">Uptime</p>
                <p className="font-medium">{mikrotikInfo.uptime}</p>
              </div>
              <div className="bg-[#0d1117] p-4 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-500">CPU</p>
                <p className="font-medium">{mikrotikInfo.cpu}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal API do controller Omada — captura de nomes de APs */}
      {apiGw && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">API do Controller — {apiGw.nome}</h3>
              <button onClick={() => setApiGw(null)} className="text-gray-400 hover:text-white cursor-pointer">×</button>
            </div>

            <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800 text-xs text-gray-400 mb-4 space-y-1">
              <p>O portal continua <b className="text-gray-300">100% via RADIUS</b> (modelo homologado) — esta API serve apenas para <b className="text-gray-300">capturar dados do controller</b>: os nomes dos access points, exibidos nos relatórios LGPD e Marco Civil.</p>
              <p>Use um <b className="text-gray-300">admin local</b> do controller (papel Viewer basta). A sincronização roda ao salvar e depois automaticamente a cada 6 horas.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">URL do controller (https://ip-do-controller)</label>
                <input className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  value={apiForm.controller_url}
                  onChange={(e) => setApiForm({ ...apiForm, controller_url: e.target.value })}
                  placeholder="https://192.168.0.10" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Admin local (Viewer)</label>
                  <input className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    value={apiForm.api_user}
                    onChange={(e) => setApiForm({ ...apiForm, api_user: e.target.value })} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Senha</label>
                  <input type="password" className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    value={apiForm.api_pass}
                    onChange={(e) => setApiForm({ ...apiForm, api_pass: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={!!Number(apiForm.verify_tls)}
                  onChange={(e) => setApiForm({ ...apiForm, verify_tls: e.target.checked ? 1 : 0 })} />
                Validar certificado TLS (deixe desligado — o controller usa certificado self-signed)
              </label>
            </div>

            {apiMsg && (
              <div className={`mt-4 rounded-lg px-3 py-2 text-sm border ${apiMsg.ok ? "bg-green-900/20 border-green-800/50 text-green-400" : "bg-red-900/20 border-red-800/50 text-red-400"}`}>
                <p>{apiMsg.texto}</p>
                {apiMsg.ok && apiMsg.aps?.length > 0 && (
                  <ul className="mt-2 text-xs text-gray-300 space-y-0.5 max-h-40 overflow-y-auto">
                    {apiMsg.aps.map((ap) => (
                      <li key={ap.mac} className="flex gap-2">
                        <span className="font-mono text-gray-500">{ap.mac}</span>
                        <span>{ap.nome || "(sem nome)"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-between items-center mt-5 pt-3 border-t border-gray-800">
              <div>
                {apiGw.controller_url && (
                  <button onClick={removerApiOmada} disabled={apiBusy}
                    className="px-3 py-2 text-xs text-red-400 border border-red-800/50 rounded hover:bg-red-900/20 cursor-pointer disabled:opacity-50">
                    Remover API
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {apiGw.controller_url && apiGw.api_user && (
                  <button onClick={sincronizarApsAgora} disabled={apiBusy}
                    className="px-4 py-2 text-sm text-purple-300 border border-purple-800/60 rounded hover:bg-purple-900/20 cursor-pointer disabled:opacity-50">
                    {apiBusy ? "Aguarde..." : "Sincronizar agora"}
                  </button>
                )}
                <button onClick={salvarApiOmada} disabled={apiBusy}
                  className={`px-4 py-2 text-sm rounded cursor-pointer font-medium ${apiBusy ? "bg-gray-700 text-gray-400" : "bg-purple-600 text-white hover:bg-purple-500"}`}>
                  {apiBusy ? "Testando e sincronizando..." : "Salvar e sincronizar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <GatewayWizard
        open={showGwWizard}
        onClose={() => { setShowGwWizard(false); setEditandoGw(null); }}
        onSaved={() => { const novo = !editandoGw; setShowGwWizard(false); setEditandoGw(null); carregarMikrotiks(novo); }}
        portais={portais}
        token={token}
        editando={editandoGw}
      />


      {/* Hotspot Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Hotspot Setup
              </h3>
              <button onClick={() => setShowWizard(false)} className="text-gray-400 hover:text-white cursor-pointer">×</button>
            </div>

            {scanning ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 border-3 border-gray-700 border-t-blue-500 rounded-full animate-spin mb-4" style={{borderWidth: '3px'}}></div>
                <p className="text-gray-400">Escaneando Mikrotik...</p>
              </div>
            ) : scanData && (
              <div className="space-y-4">
                {/* Status */}
                <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-gray-500">Interfaces</span>
                      <p className="text-white font-medium">{scanData.interfaces?.length || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Pools</span>
                      <p className="text-white font-medium">{scanData.pools?.length || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Hotspot Ativo</span>
                      <p className="text-white font-medium">{scanData.hotspots?.length ? "Sim" : "Não"}</p>
                    </div>
                  </div>
                </div>

                {/* Bridge com varias portas/radios (opcional) */}
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wizardConfig.criarBridge}
                      onChange={(e) => {
                        const ligar = e.target.checked;
                        const livres = (scanData.interfaces || []).filter(i =>
                          /^(ether|wlan|wifi)/i.test(i.name) && !i.wan && !i.bridge &&
                          !(scanData.addresses || []).some(a => a.interface === i.name));
                        setWizardConfig({
                          ...wizardConfig,
                          criarBridge: ligar,
                          portasBridge: ligar ? livres.filter(i => /^(wlan|wifi)/i.test(i.name)).map(i => i.name) : [],
                        });
                      }}
                    />
                    Usar uma bridge com várias portas/rádios (Wi-Fi 2.4 + 5 GHz e portas)
                  </label>
                  <p className="text-xs text-gray-600 mt-1">Cria a bridge "bridge-hotspot" e atende todas as portas marcadas na mesma rede. Portas com IP, DHCP próprio, em outra bridge ou a WAN não podem entrar.</p>
                </div>

                {wizardConfig.criarBridge && (
                  <div className="space-y-1">
                    <label className="block text-xs text-gray-500">Portas/rádios da bridge</label>
                    {(scanData.interfaces || []).filter(i => /^(ether|wlan|wifi)/i.test(i.name)).map(i => {
                      const motivo = i.wan ? "WAN" : i.bridge ? "já é porta de bridge" : (scanData.addresses || []).some(a => a.interface === i.name) ? "tem IP" : "";
                      return (
                        <label key={i.name} className={`flex items-center gap-2 text-sm ${motivo ? "text-gray-600" : "text-gray-300 cursor-pointer"}`}>
                          <input
                            type="checkbox"
                            disabled={!!motivo}
                            checked={wizardConfig.portasBridge.includes(i.name)}
                            onChange={(e) => setWizardConfig({
                              ...wizardConfig,
                              portasBridge: e.target.checked
                                ? [...wizardConfig.portasBridge, i.name]
                                : wizardConfig.portasBridge.filter(n => n !== i.name),
                            })}
                          />
                          {i.name} ({i.type}){motivo ? ` — ${motivo}` : ""}
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Interface Selection */}
                {!wizardConfig.criarBridge && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Interface do Hotspot</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 cursor-pointer"
                    value={wizardConfig.interface}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, interface: e.target.value })}
                  >
                    {scanData.interfaces?.map(i => (
                      <option key={i.name} value={i.name} disabled={i.wan || i.bridge || i.tunel}>
                        {i.name} ({i.type}){i.wan ? " [WAN - nao usar]" : ""}{i.tunel ? " [VPN/tunel - nao usar]" : ""}{i.bridge ? " [porta de bridge]" : ""}{i.disabled === "true" ? " [desabilitada]" : ""}
                      </option>
                    ))}
                  </select>
                  {scanData.addresses?.filter(a => a.interface === wizardConfig.interface).map(a => (
                    <p key={a.address} className="text-xs text-green-500 mt-1">IP atual: {a.address}</p>
                  ))}
                </div>
                )}

                {/* SSID (so para interface Wi-Fi) */}
                {(wizardConfig.criarBridge ? wizardConfig.portasBridge.some(n => /^wlan|^wifi/i.test(n)) : /^wlan|^wifi/i.test(wizardConfig.interface || "")) && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nome do Wi-Fi (SSID)</label>
                    <input
                      className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      value={wizardConfig.wifiSsid}
                      onChange={(e) => setWizardConfig({ ...wizardConfig, wifiSsid: e.target.value })}
                      placeholder="Ex.: Wi-Fi Grátis"
                      maxLength={32}
                    />
                    <p className="text-xs text-gray-600 mt-1">Coloca o rádio em modo AP com este nome. Vazio = não altera o Wi-Fi.</p>
                  </div>
                )}

                {/* DNS seguro */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">DNS seguro (bloqueia conteúdo adulto)</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.dnsSeguro}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, dnsSeguro: e.target.value })}
                  >
                    <option value="">Não alterar (padrão)</option>
                    <option value="ligar">Ligar (OpenDNS FamilyShield)</option>
                    <option value="desligar">Desligar (volta ao DNS padrão)</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Aparelho com DNS fixo ou DNS seguro no navegador contorna o filtro.</p>
                </div>

                {/* on-logout */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Derrubar o aparelho do Wi-Fi ao fim da sessão</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.onLogout}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, onLogout: e.target.value })}
                  >
                    <option value="">Não alterar (padrão)</option>
                    <option value="ligar">Ligar</option>
                    <option value="desligar">Desligar</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Ao acabar o tempo, remove o aparelho do Wi-Fi para ele reconectar e abrir o portal. Só age se o aparelho não tiver outra sessão ativa; não sobrescreve um on-logout já existente.</p>
                </div>

                {/* BlockRedirect */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Forçar o pop-up do portal (BlockRedirect)</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.blockRedirect}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, blockRedirect: e.target.value })}
                  >
                    <option value="">Não alterar (padrão)</option>
                    <option value="ligar">Ligar</option>
                    <option value="desligar">Desligar</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Garante o redirecionamento dos testes de conexão do Android, iPhone e Windows para o portal (o pop-up abre). Só mexe nas regras com o comentário apex-blockredirect.</p>
                </div>

                {/* Log de conexoes */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Log de conexões novas no roteador (diagnóstico)</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.logConexoes}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, logConexoes: e.target.value })}
                  >
                    <option value="">Não alterar (padrão)</option>
                    <option value="ligar">Ligar</option>
                    <option value="desligar">Desligar</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Registra as conexões novas dos clientes (até 300 linhas, com limite de taxa). Serve só para diagnóstico: aumenta o uso de CPU e o log do roteador, e o registro legal do Marco Civil continua sendo o das sessões. Desligue depois de usar.</p>
                </div>

                {/* Tamanho da rede */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tamanho da rede (clientes ao mesmo tempo)</label>
                  <select
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={PRESETS_REDE.find(p => p.localAddress === wizardConfig.localAddress && p.poolRange === wizardConfig.poolRange)?.id || "personalizado"}
                    onChange={(e) => {
                      const p = PRESETS_REDE.find(x => x.id === e.target.value);
                      if (p) setWizardConfig({ ...wizardConfig, localAddress: p.localAddress, poolRange: p.poolRange });
                    }}
                  >
                    {PRESETS_REDE.map(p => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
                    <option value="personalizado">Personalizado (editar abaixo)</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Para eventos e locais grandes use /22. Se o roteador já tem uma rede nessa faixa em outra interface, o envio é recusado.</p>
                </div>

                {/* Local Address */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Endereço IP do Hotspot (gateway)</label>
                  <input
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.localAddress}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, localAddress: e.target.value })}
                    placeholder="10.5.50.1/24"
                  />
                  <p className="text-xs text-gray-600 mt-1">Será atribuído à interface se ainda não tiver IP</p>
                </div>

                {/* Pool */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nome do Pool</label>
                    <input
                      className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      value={wizardConfig.poolName}
                      onChange={(e) => setWizardConfig({ ...wizardConfig, poolName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Range do Pool</label>
                    <input
                      className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      value={wizardConfig.poolRange}
                      onChange={(e) => setWizardConfig({ ...wizardConfig, poolRange: e.target.value })}
                      placeholder="10.5.50.2-10.5.50.254"
                    />
                  </div>
                </div>
                {scanData.pools?.length > 0 && (
                  <div className="text-xs text-gray-600">
                    Pools existentes: {scanData.pools.map(p => `${p.name} (${p.ranges})`).join(", ")}
                  </div>
                )}

                {/* DNS Name */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">DNS Name (opcional)</label>
                  <input
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    value={wizardConfig.dnsName}
                    onChange={(e) => setWizardConfig({ ...wizardConfig, dnsName: e.target.value })}
                    placeholder="Deixe vazio para usar o IP do hotspot"
                  />
                </div>

                {/* RADIUS + Walled Garden info */}
                <div className="bg-[#0d1117] rounded-lg p-3 border border-gray-800 text-xs text-gray-400 space-y-1">
                  <p className="text-gray-500 font-medium mb-1">Será configurado automaticamente:</p>
                  <p>• RADIUS Client → 10.8.0.1:1812/1813</p>
                  <p>• Walled Garden → domínio do sistema liberado</p>
                  <p>• Login URL → redirect para o portal vinculado</p>
                  {scanData.radius?.length > 0 && (
                    <p className="text-yellow-500 mt-1">Atenção: RADIUS existente será atualizado ({scanData.radius[0].address})</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                  <button
                    onClick={() => setShowWizard(false)}
                    className="px-4 py-2 text-sm text-gray-300 border border-gray-700 rounded hover:bg-[#252b3b] cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={executarWizard}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer font-medium"
                  >
                    Configurar Hotspot
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diagnostico do hotspot */}
      {diag && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold text-white">Diagnóstico do hotspot{diag.nome ? ` — ${diag.nome}` : ""}</h3>
              <button onClick={() => setDiag(null)} className="text-gray-400 hover:text-white cursor-pointer">×</button>
            </div>
            {diag.carregando && <p className="text-sm text-gray-400 animate-pulse">Lendo o roteador (pode levar até 1 minuto em roteador lento)...</p>}
            {diag.erro && <p className="text-sm text-red-400 mb-2">{diag.erro}</p>}
            {diag.msg && <p className="text-sm text-green-400 mb-2">{diag.msg}</p>}
            {diag.dados && (
              <>
                <p className="text-xs text-gray-400 mb-3">
                  {diag.dados.resumo.erro} erro(s), {diag.dados.resumo.aviso} aviso(s), {diag.dados.resumo.ok} ok. Só leitura: nada foi alterado.
                </p>
                <div className="space-y-2">
                  {diag.dados.checks.map(c => (
                    <div key={c.id + c.titulo} className={`rounded-lg border p-3 text-sm ${c.status === "erro" ? "border-red-800/60 bg-red-900/10" : c.status === "aviso" ? "border-yellow-800/60 bg-yellow-900/10" : "border-green-900/50 bg-green-900/5"}`}>
                      <div className="flex items-start gap-2">
                        <span className={c.status === "erro" ? "text-red-400" : c.status === "aviso" ? "text-yellow-400" : "text-green-400"}>{c.status === "erro" ? "✗" : c.status === "aviso" ? "!" : "✓"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium">{c.titulo}</p>
                          {c.detalhe && <p className="text-xs text-gray-400 break-words">{c.detalhe}</p>}
                          {c.correcao && typeof c.correcao === "string" && <p className="text-xs text-gray-500 mt-1">Como corrigir: {c.correcao}</p>}
                          {c.correcao && typeof c.correcao === "object" && (
                            <button
                              disabled={!!diag.corrigindo}
                              onClick={() => corrigirDiag(c.correcao.acao, c.correcao.texto)}
                              className="mt-2 px-3 py-1 rounded text-xs bg-amber-600 text-white hover:bg-amber-500 cursor-pointer disabled:opacity-50"
                            >
                              {diag.corrigindo === c.correcao.acao ? "Corrigindo..." : c.correcao.texto}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-between mt-4">
              <button onClick={() => diagnosticar({ id: diag.id, nome: diag.nome })} disabled={diag.carregando} className="px-3 py-2 rounded text-sm border border-gray-700 text-gray-300 hover:bg-[#252b3b] cursor-pointer disabled:opacity-50">Diagnosticar de novo</button>
              <button onClick={() => setDiag(null)} className="px-4 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-500 cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Hotspot Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                Log de Configuracao
                {enviandoHotspot && (
                  <div className="w-4 h-4 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin"></div>
                )}
              </h3>
              <button onClick={() => { if (!enviandoHotspot) setShowLogModal(false); }} className={`text-gray-400 hover:text-white cursor-pointer ${enviandoHotspot ? 'opacity-30 cursor-not-allowed' : ''}`}>×</button>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-4 font-mono text-xs max-h-80 overflow-y-auto space-y-1" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
              {hotspotLog.length === 0 && enviandoHotspot && (
                <div className="text-gray-500 animate-pulse">Conectando ao Mikrotik...</div>
              )}
              {hotspotLog.map((line, i) => (
                <div key={i} className={`flex items-start gap-2 ${
                  line.includes('[erro]') ? 'text-red-400' :
                  line.includes('[aviso]') ? 'text-yellow-400' :
                  line.startsWith('---') ? 'text-blue-400 font-semibold mt-2' :
                  'text-green-400'
                }`}>
                  <span className="text-gray-600 select-none shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowLogModal(false)}
                disabled={!!enviandoHotspot}
                className={`px-4 py-2 rounded cursor-pointer text-sm ${enviandoHotspot ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
              >
                {enviandoHotspot ? "Aguarde..." : "Fechar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

