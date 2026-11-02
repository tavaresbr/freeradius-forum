import React, { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import NumerosWhatsapp from "../../components/admin/atendimento/NumerosWhatsapp";

export default function WhatsApp() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [mensagemTeste, setMensagemTeste] = useState({ telefone: "", mensagem: "" });
  const [envioResult, setEnvioResult] = useState(null);
  const [config, setConfig] = useState({ api_url: "", api_key: "", instance_name: "" });
  const [configSaved, setConfigSaved] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const { empresaSlug } = useParams();
  const [recebimento, setRecebimento] = useState(null); // { ativo } do webhook de atendimento
  const [recebimentoMsg, setRecebimentoMsg] = useState("");
  const [recebimentoBusy, setRecebimentoBusy] = useState(false);
  const token = localStorage.getItem("admin_token");
  const pollingRef = useRef(null);

  // Historico de envios
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsFilter, setLogsFilter] = useState({ status: "", telefone: "" });
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [cleanupDate, setCleanupDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [showCleanup, setShowCleanup] = useState(false);
  const PER_PAGE = 20;

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    fetchLogs();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  useEffect(() => {
    fetch("/api/whatsapp/webhook/status", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRecebimento(d))
      .catch(() => {});
    // eslint-disable-next-line
  }, []);

  const ativarRecebimento = async () => {
    setRecebimentoBusy(true);
    setRecebimentoMsg("");
    try {
      const res = await fetch("/api/whatsapp/webhook/ativar", { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRecebimento({ ativo: true });
      else setRecebimentoMsg(data.error || "Não foi possível ativar");
    } catch {
      setRecebimentoMsg("Erro de conexão");
    } finally {
      setRecebimentoBusy(false);
    }
  };

  useEffect(() => { fetchLogs(); /* eslint-disable-next-line */ }, [logsPage, logsFilter.status]);

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams({ page: logsPage, per_page: PER_PAGE });
      if (logsFilter.status) params.append("status", logsFilter.status);
      if (logsFilter.telefone) params.append("telefone", logsFilter.telefone);
      const res = await fetch(`/api/whatsapp/logs?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogsTotal(data.total || 0);
      }
    } catch (err) { console.error("Erro ao buscar logs:", err); }
  };

  const handleLimparLogs = async () => {
    if (!confirm(`Remover todos os logs anteriores a ${cleanupDate}?`)) return;
    try {
      const res = await fetch(`/api/whatsapp/logs?antes_de=${cleanupDate}`, {
        method: "DELETE", headers,
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${data.removidos} logs removidos.`);
        setShowCleanup(false);
        setLogsPage(1);
        fetchLogs();
      }
    } catch (err) {
      alert("Erro ao limpar logs");
    }
  };

  const formatDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const statusBadge = (s) => {
    if (s === "ok") return <span className="px-2 py-0.5 text-xs rounded bg-green-900/30 text-green-400 border border-green-800/50">OK</span>;
    if (s === "erro") return <span className="px-2 py-0.5 text-xs rounded bg-red-900/30 text-red-400 border border-red-800/50">Erro</span>;
    if (s === "skipped") return <span className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-400 border border-gray-700">Pulado</span>;
    return <span className="text-xs text-gray-500">{s}</span>;
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/whatsapp/config", { headers });
      const data = await res.json();
      setConfig({ api_url: data.api_url || "", api_key: data.api_key || "", instance_name: data.instance_name || "" });
    } catch (err) { console.error("Erro ao buscar config:", err); }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSaved(null);
    try {
      const res = await fetch("/api/whatsapp/config", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setConfigSaved({ ok: true, msg: "Configuracao salva!" });
        fetchStatus();
      } else {
        setConfigSaved({ ok: false, msg: "Erro ao salvar." });
      }
    } catch (err) {
      setConfigSaved({ ok: false, msg: "Erro de conexao." });
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/whatsapp/instance/status", { headers });
      const data = await res.json();
      setStatus(data);
      // Se estava mostrando QR e agora conectou, limpar QR
      if (data.state === "open") {
        setQrCode(null);
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      }
    } catch (err) {
      console.error("Erro ao buscar status:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/whatsapp/instance/create", { method: "POST", headers });
      await res.json();
      await fetchStatus();
      // Apos criar, buscar QR automaticamente
      handleConnect();
    } catch (err) {
      console.error("Erro ao criar instancia:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConnect = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/whatsapp/instance/qrcode", { headers });
      const data = await res.json();
      if (data.base64) {
        setQrCode(data.base64);
        // Polling para verificar quando conectar
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(fetchStatus, 5000);
      } else if (data.instance?.state === "open") {
        setQrCode(null);
        await fetchStatus();
      }
    } catch (err) {
      console.error("Erro ao obter QR:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      await fetch("/api/whatsapp/instance/restart", { method: "POST", headers });
      setTimeout(fetchStatus, 3000);
    } catch (err) {
      console.error("Erro ao reiniciar:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm("Desconectar o WhatsApp? Voce precisara escanear o QR Code novamente.")) return;
    setActionLoading(true);
    try {
      await fetch("/api/whatsapp/instance/logout", { method: "POST", headers });
      setQrCode(null);
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      console.error("Erro ao desconectar:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remover a instancia completamente? Todos os dados serao perdidos.")) return;
    setActionLoading(true);
    try {
      await fetch("/api/whatsapp/instance/delete", { method: "DELETE", headers });
      setQrCode(null);
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      console.error("Erro ao remover:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnviarTeste = async (e) => {
    e.preventDefault();
    setEnvioResult(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ telefone: `55${mensagemTeste.telefone}`, mensagem: mensagemTeste.mensagem }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnvioResult({ ok: true, msg: "Mensagem enviada com sucesso!" });
        setMensagemTeste({ telefone: "", mensagem: "" });
      } else {
        setEnvioResult({ ok: false, msg: data.error || "Erro ao enviar." });
      }
    } catch (err) {
      setEnvioResult({ ok: false, msg: "Erro de conexao." });
    }
  };

  const stateLabel = (state) => {
    const labels = {
      open: { text: "Conectado", color: "bg-green-500" },
      close: { text: "Desconectado", color: "bg-red-500" },
      connecting: { text: "Conectando...", color: "bg-yellow-500" },
    };
    return labels[state] || { text: state || "Desconhecido", color: "bg-gray-500" };
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <h1 className="text-2xl font-bold mb-6">WhatsApp</h1>

      {/* Status Card */}
      <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Status da Instancia</h2>
          <button onClick={fetchStatus} className="text-sm text-blue-400 hover:text-blue-300">
            Atualizar
          </button>
        </div>

        {!status?.exists ? (
          /* Instancia nao existe */
          <div className="text-center py-8">
            <div className="text-6xl mb-4 opacity-30">
              <svg className="w-16 h-16 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
            </div>
            <p className="text-gray-400 mb-4">Nenhuma instancia WhatsApp configurada.</p>
            <button
              onClick={handleCreate}
              disabled={actionLoading}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {actionLoading ? "Criando..." : "Criar Instancia"}
            </button>
          </div>
        ) : (
          /* Instancia existe */
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {/* Estado */}
              <div className="bg-[#0f111a] rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${stateLabel(status.state).color}`}></span>
                  <span className="font-medium">{stateLabel(status.state).text}</span>
                </div>
              </div>

              {/* Numero */}
              <div className="bg-[#0f111a] rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Numero</p>
                <p className="font-medium">{status.number || status.owner_jid?.split("@")[0] || "-"}</p>
              </div>

              {/* Nome */}
              <div className="bg-[#0f111a] rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Nome do Perfil</p>
                <p className="font-medium">{status.profile_name || "-"}</p>
              </div>

              {/* Instancia */}
              <div className="bg-[#0f111a] rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Instancia</p>
                <p className="font-medium font-mono text-sm">{status.instance_name}</p>
              </div>
            </div>

            {/* Estatisticas */}
            {status.state === "open" && (
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-[#0f111a] rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-blue-400">{status.messages_count}</p>
                  <p className="text-xs text-gray-500">Mensagens</p>
                </div>
                <div className="bg-[#0f111a] rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-400">{status.contacts_count}</p>
                  <p className="text-xs text-gray-500">Contatos</p>
                </div>
                <div className="bg-[#0f111a] rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-purple-400">{status.chats_count}</p>
                  <p className="text-xs text-gray-500">Conversas</p>
                </div>
              </div>
            )}

            {/* QR Code */}
            {qrCode && status.state !== "open" && (
              <div className="bg-[#0f111a] rounded-lg p-6 mb-6 text-center">
                <p className="text-sm text-gray-400 mb-4">Escaneie o QR Code com seu WhatsApp:</p>
                <img src={qrCode} alt="QR Code WhatsApp" className="mx-auto w-64 h-64 rounded-lg bg-white p-2" />
                <p className="text-xs text-gray-500 mt-3">Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho</p>
              </div>
            )}

            {/* Acoes */}
            <div className="flex flex-wrap gap-3">
              {status.state !== "open" && (
                <button
                  onClick={handleConnect}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {actionLoading ? "..." : "Conectar (QR Code)"}
                </button>
              )}
              <button
                onClick={handleRestart}
                disabled={actionLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Reiniciar
              </button>
              {status.state === "open" && (
                <button
                  onClick={handleLogout}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Desconectar
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Remover Instancia
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Enviar mensagem de teste */}
      {status?.exists && <NumerosWhatsapp headers={headers} />}

      {/* Recebimento de mensagens (atendimento) */}
      <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Recebimento de mensagens</h2>
            <p className="text-sm text-gray-400 mt-1">
              Permite ver e responder as mensagens dos clientes no menu <Link to={`/admin/${empresaSlug}/atendimento`} className="text-blue-400 hover:text-blue-300">WhatsApp</Link>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {recebimento && (
              <span className={`text-xs px-2 py-1 rounded-md border ${recebimento.ativo ? "bg-green-900/40 text-green-400 border-green-800/50" : "bg-gray-800 text-gray-400 border-gray-700"}`}>
                {recebimento.ativo ? "Ativo" : "Não ativo"}
              </span>
            )}
            <button onClick={ativarRecebimento} disabled={recebimentoBusy || !status?.exists} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50 cursor-pointer">
              {recebimentoBusy ? "Ativando..." : recebimento?.ativo ? "Reativar" : "Ativar recebimento"}
            </button>
          </div>
        </div>
        {recebimentoMsg && <p className="text-sm text-red-400 mt-3">{recebimentoMsg}</p>}
      </div>

      {/* Configuracao Evolution API */}
      <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Configuracao da API</h2>
          <button onClick={() => setShowConfig(!showConfig)} className="text-sm text-blue-400 hover:text-blue-300">
            {showConfig ? "Ocultar" : "Editar"}
          </button>
        </div>

        {!showConfig ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#0f111a] rounded-lg p-3">
              <p className="text-xs text-gray-500">URL da API</p>
              <p className="text-sm font-mono truncate">{config.api_url || "-"}</p>
            </div>
            <div className="bg-[#0f111a] rounded-lg p-3">
              <p className="text-xs text-gray-500">API Key</p>
              <p className="text-sm font-mono truncate">{config.api_key ? "••••••••" + config.api_key.slice(-8) : "-"}</p>
            </div>
            <div className="bg-[#0f111a] rounded-lg p-3">
              <p className="text-xs text-gray-500">Nome da Instancia</p>
              <p className="text-sm font-mono">{config.instance_name || "-"}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">URL da Evolution API</label>
              <input
                type="text"
                placeholder="http://localhost:8080"
                value={config.api_url}
                onChange={(e) => setConfig(prev => ({ ...prev, api_url: e.target.value }))}
                className="w-full bg-[#0f111a] border border-gray-700 text-gray-200 rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">API Key</label>
              <input
                type="text"
                placeholder="Chave da API"
                value={config.api_key}
                onChange={(e) => setConfig(prev => ({ ...prev, api_key: e.target.value }))}
                className="w-full bg-[#0f111a] border border-gray-700 text-gray-200 rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nome da Instancia</label>
              <input
                type="text"
                placeholder="empresa_1"
                value={config.instance_name}
                onChange={(e) => setConfig(prev => ({ ...prev, instance_name: e.target.value }))}
                className="w-full bg-[#0f111a] border border-gray-700 text-gray-200 rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {configSaved && (
              <div className={`px-4 py-2 rounded-lg text-sm ${configSaved.ok ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                {configSaved.msg}
              </div>
            )}
            <button type="submit" className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm">
              Salvar Configuracao
            </button>
          </form>
        )}
      </div>

      {/* Enviar mensagem teste */}
      {status?.exists && status?.state === "open" && (
        <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Enviar Mensagem de Teste</h2>

          <form onSubmit={handleEnviarTeste} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Telefone (DDD + numero)</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 bg-[#252b3b] border border-r-0 border-gray-700 text-gray-400 rounded-l-lg text-sm">+55</span>
                <input
                  type="text"
                  placeholder="41999999999"
                  value={mensagemTeste.telefone}
                  onChange={(e) => setMensagemTeste(prev => ({ ...prev, telefone: e.target.value.replace(/\D/g, "") }))}
                  required
                  className="flex-1 bg-[#0f111a] border border-gray-700 text-gray-200 rounded-r-lg px-4 py-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Mensagem</label>
              <textarea
                placeholder="Digite sua mensagem..."
                value={mensagemTeste.mensagem}
                onChange={(e) => setMensagemTeste(prev => ({ ...prev, mensagem: e.target.value }))}
                required
                rows={3}
                className="w-full bg-[#0f111a] border border-gray-700 text-gray-200 rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
            </div>

            {envioResult && (
              <div className={`px-4 py-2 rounded-lg text-sm ${envioResult.ok ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                {envioResult.msg}
              </div>
            )}

            <button
              type="submit"
              className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm"
            >
              Enviar
            </button>
          </form>
        </div>
      )}

      {/* Historico de envios */}
      <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mt-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">Histórico de Envios</h2>
            <p className="text-xs text-gray-500">Mensagens disparadas automaticamente pelos portais</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={logsFilter.status}
              onChange={(e) => { setLogsFilter({ ...logsFilter, status: e.target.value }); setLogsPage(1); }}
              className="bg-[#0f111a] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              <option value="ok">OK</option>
              <option value="erro">Erro</option>
              <option value="skipped">Pulado</option>
            </select>
            <input
              type="text"
              value={logsFilter.telefone}
              onChange={(e) => setLogsFilter({ ...logsFilter, telefone: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { setLogsPage(1); fetchLogs(); } }}
              placeholder="Buscar telefone..."
              className="bg-[#0f111a] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 w-40"
            />
            <button
              onClick={() => { setLogsPage(1); fetchLogs(); }}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg cursor-pointer"
            >
              Filtrar
            </button>
            <button
              onClick={() => setShowCleanup(!showCleanup)}
              className="px-3 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 text-sm rounded-lg cursor-pointer"
            >
              🗑 Limpar
            </button>
          </div>
        </div>

        {showCleanup && (
          <div className="mb-4 p-4 bg-red-900/10 border border-red-900/30 rounded-lg flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-300">Remover logs anteriores a:</span>
            <input
              type="date"
              value={cleanupDate}
              onChange={(e) => setCleanupDate(e.target.value)}
              className="bg-[#0f111a] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2"
            />
            <button
              onClick={handleLimparLogs}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg cursor-pointer"
            >
              Confirmar
            </button>
            <button
              onClick={() => setShowCleanup(false)}
              className="px-3 py-2 border border-gray-700 text-gray-400 hover:text-white text-sm rounded-lg cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0f111a] text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Telefone</th>
                <th className="text-left px-3 py-2">Portal</th>
                <th className="text-left px-3 py-2">Contexto</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-8 text-gray-500">Nenhum log encontrado</td></tr>
              ) : logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="border-t border-gray-800 hover:bg-[#0f111a]">
                    <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{formatDate(log.criado_em)}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono text-xs">{log.telefone || "-"}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{log.portal_nome || "-"}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{log.contexto_tipo || "-"}</td>
                    <td className="px-3 py-2">
                      {statusBadge(log.status)}
                      {log.skip_motivo && <span className="ml-2 text-xs text-gray-500">({log.skip_motivo})</span>}
                    </td>
                    <td className="px-3 py-2">
                      {(log.mensagem || log.erro_msg) && (
                        <button
                          onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                          className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          {expandedLogId === log.id ? "Ocultar" : "Ver"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedLogId === log.id && (
                    <tr className="bg-[#0f111a]">
                      <td colSpan="6" className="px-3 py-3">
                        {log.erro_msg && (
                          <div className="mb-2">
                            <div className="text-xs text-red-400 font-medium mb-1">Erro:</div>
                            <div className="text-xs text-red-300 font-mono">{log.erro_msg}</div>
                          </div>
                        )}
                        {log.mensagem && (
                          <div>
                            <div className="text-xs text-gray-400 font-medium mb-1">Mensagem enviada:</div>
                            <div className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-[#1a1d27] p-2 rounded">{log.mensagem}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginacao */}
        {logsTotal > PER_PAGE && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-400">
              {((logsPage - 1) * PER_PAGE) + 1}-{Math.min(logsPage * PER_PAGE, logsTotal)} de {logsTotal}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                disabled={logsPage === 1}
                className="px-3 py-1.5 bg-[#0f111a] border border-gray-700 text-gray-300 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                ← Anterior
              </button>
              <span className="text-gray-400">Página {logsPage} de {Math.ceil(logsTotal / PER_PAGE)}</span>
              <button
                onClick={() => setLogsPage((p) => p + 1)}
                disabled={logsPage * PER_PAGE >= logsTotal}
                className="px-3 py-1.5 bg-[#0f111a] border border-gray-700 text-gray-300 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
