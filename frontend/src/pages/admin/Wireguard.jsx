import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Wireguard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newPeerName, setNewPeerName] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptData, setScriptData] = useState("");
  const [scriptCopiado, setScriptCopiado] = useState(false);
  const [serverSettings, setServerSettings] = useState({ wgPort: '51820', wgHost: '92.113.34.197' });
  const [editSettings, setEditSettings] = useState({ wgPort: '', wgHost: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const token = localStorage.getItem("admin_token");

  const loadStatus = async () => {
    try {
      // In a real scenario we use the token, here the proxy is unprotected for now but we send it anyway
      const res = await fetch("/api/wireguard/status", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Erro ao carregar VPN:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/wireguard/settings", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setServerSettings(data);
      setEditSettings({ wgPort: data.wgPort, wgHost: data.wgHost });
    } catch (err) {
      console.error("Erro ao carregar settings:", err);
    }
  };

  useEffect(() => {
    loadStatus();
    loadSettings();
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleAddPeer = async (e) => {
    e.preventDefault();
    if (!newPeerName) return;
    try {
      const res = await fetch("/api/wireguard/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newPeerName })
      });
      
      // wg-easy doesn't return the new client ID, we must fetch it from the list
      const statusRes = await fetch("/api/wireguard/status", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const statusData = await statusRes.json();
      const createdClient = statusData.clients.find(c => c.name === newPeerName);

      if (!createdClient) throw new Error("Cliente não encontrado");

      const scriptRes = await fetch(`/api/wireguard/clients/${createdClient.id}/config`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const scriptJson = await scriptRes.json();
      
      setShowAddModal(false);
      setNewPeerName("");
      setScriptData(scriptJson.routerOsScript);
      setShowScriptModal(true);
      loadStatus();
    } catch (err) {
      alert("Erro ao criar peer");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Deseja deletar este peer? Isso derrubará a VPN do Mikrotik!")) return;
    try {
      await fetch(`/api/wireguard/clients/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      loadStatus();
    } catch (err) {
      alert("Erro ao deletar");
    }
  };

  const showScript = async (id) => {
    try {
      const scriptRes = await fetch(`/api/wireguard/clients/${id}/config`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const scriptJson = await scriptRes.json();
      setScriptData(scriptJson.routerOsScript);
      setShowScriptModal(true);
    } catch (err) {
      alert("Erro ao carregar script");
    }
  };

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(scriptData);
      } else {
        // Fallback para contextos sem Clipboard API (http, navegadores antigos)
        const ta = document.createElement("textarea");
        ta.value = scriptData;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setScriptCopiado(true);
      setTimeout(() => setScriptCopiado(false), 2500);
    } catch (err) {
      alert("Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C.");
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading && !status) return <AdminLayout><div className="p-8 text-center bg-[#0d1117] min-h-screen text-white">Carregando VPN...</div></AdminLayout>;

  return (
    <AdminLayout>
      {/* Wrapper to override light theme of AdminLayout with Dark theme for this page */}
      <div className="space-y-6">
        
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
            VPN WireGuard
          </h1>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold shadow-lg shadow-green-900/40 hover:bg-green-500 transition-colors"
          >
            <span className="text-lg leading-none">+</span> Adicionar Peer
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors ml-4"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            Configurações
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-[#1a1d27] rounded-lg p-5 border border-gray-800 mb-4">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              Configurações do Servidor VPN
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">IP Público / Domínio</label>
                <input
                  className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  value={editSettings.wgHost}
                  onChange={(e) => setEditSettings({...editSettings, wgHost: e.target.value})}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Porta UDP do WireGuard</label>
                <input
                  type="number"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  value={editSettings.wgPort}
                  onChange={(e) => setEditSettings({...editSettings, wgPort: e.target.value})}
                  min="1024"
                  max="65535"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                disabled={savingSettings}
                onClick={async () => {
                  setSavingSettings(true);
                  try {
                    const res = await fetch("/api/wireguard/settings", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                      body: JSON.stringify(editSettings)
                    });
                    const data = await res.json();
                    if (data.success) {
                      setServerSettings(data.settings);
                      alert("Configurações salvas! O servidor WireGuard foi reiniciado.");
                      loadStatus();
                    } else {
                      alert("Erro: " + (data.message || "Falha ao salvar"));
                    }
                  } catch (err) {
                    alert("Erro ao salvar configurações");
                  } finally {
                    setSavingSettings(false);
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingSettings ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Reiniciando VPN...</>
                ) : 'Salvar e Reiniciar VPN'}
              </button>
              <p className="text-xs text-yellow-500">⚠️ Alterar a porta irá desconectar todos os peers temporariamente.</p>
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-[#1a1d27] rounded-lg p-5 border border-gray-800">
            <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Sub-rede</h3>
            <p className="text-xl font-bold text-white">{status?.server?.subNet}</p>
          </div>
          <div className="bg-[#1a1d27] rounded-lg p-5 border border-gray-800">
            <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Endpoint</h3>
            <p className="text-xl font-bold text-blue-400">{status?.server?.endpoint}</p>
          </div>
          <div className="bg-[#1a1d27] rounded-lg p-5 border border-gray-800">
            <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Server IP / Peers</h3>
            <p className="text-xl font-bold text-white">
              {status?.server?.address} <span className="text-sm font-normal text-gray-500 ml-2">{status?.clients?.filter(c => c.latestHandshakeAt).length} / {status?.clients?.length} online</span>
            </p>
          </div>
        </div>

        {/* Public Key Bar */}
        <div className="bg-[#1a1d27] rounded-lg p-4 mb-6 border border-gray-800 flex items-center gap-4">
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Server Public Key</h3>
            <p className="text-sm font-mono text-gray-300 select-all">{status?.server?.publicKey}</p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#1e2330] rounded-xl overflow-hidden border border-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#1a1d27] text-xs uppercase text-gray-500 font-semibold tracking-wide">
                <tr>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Identificação</th>
                  <th className="px-6 py-4">IP VPN</th>
                  <th className="px-6 py-4">Tipo</th>
                  <th className="px-6 py-4">Último Handshake</th>
                  <th className="px-6 py-4">Tráfego</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {status?.clients?.map((client) => {
                  const isOnline = client.latestHandshakeAt && (new Date() - new Date(client.latestHandshakeAt)) < 180000; // 3 min
                  return (
                    <tr key={client.id} className="hover:bg-[#252b3b] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></span>
                          <span className={isOnline ? 'text-green-400' : 'text-gray-500'}>{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-white">{client.name}</td>
                      <td className="px-6 py-4 text-gray-400">{client.address}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-blue-900/30 text-blue-400 text-xs rounded border border-blue-800/50">MikroTik</span>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {client.latestHandshakeAt ? new Date(client.latestHandshakeAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-xs">
                        <span className="text-green-400">↓ {formatBytes(client.transferRx)}</span> &nbsp; <span className="text-blue-400">↑ {formatBytes(client.transferTx)}</span>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-3">
                        <button onClick={() => showScript(client.id)} className="text-blue-400 hover:text-blue-300" title="Ver Script Mikrotik">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                        </button>
                        <button onClick={() => handleDelete(client.id)} className="text-red-500 hover:text-red-400" title="Deletar">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {(!status?.clients || status.clients.length === 0) && (
                  <tr>
                    <td colSpan="7" className="px-6 py-8 text-center text-gray-500">Nenhum peer cadastrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold text-white mb-4">Adicionar Peer</h3>
            <form onSubmit={handleAddPeer} className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Identificação (Nome do Mikrotik)</label>
                <input
                  autoFocus
                  placeholder="Ex: RB-Torre-Centro"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                  value={newPeerName}
                  onChange={(e) => setNewPeerName(e.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded text-gray-400 hover:text-white">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">Salvar e Gerar Script</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Script Modal */}
      {showScriptModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-[#1a1d27] border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Script de Instalação Rápida</h3>
                <p className="text-gray-400 text-xs mt-1">
                  Para um Mikrotik <strong>resetado com "No Default Configuration"</strong> (ether1 = internet). Cole no terminal (New Terminal) do roteador: configura internet, DNS, NAT, firewall, hora, VPN, API e Wi-Fi, e deixa só o wizard de Hotspot para o painel.
                </p>
              </div>
              <button onClick={() => setShowScriptModal(false)} className="text-gray-400 hover:text-white text-2xl leading-none" title="Fechar">&times;</button>
            </div>

            <p className="text-yellow-400 text-xs mb-3">
              Depois de colar: defina a senha do admin (<code>/user set admin password=...</code>) e use a mesma ao cadastrar o equipamento. Pode colar de novo sem erro.
            </p>

            <div className="bg-[#0d1117] rounded-lg border border-gray-800 overflow-auto min-h-0 flex-1 max-h-[50vh]">
              <pre className="text-xs leading-relaxed text-green-400 font-mono whitespace-pre-wrap break-words p-3">
                {scriptData}
              </pre>
            </div>

            <div className="flex items-center justify-between gap-3 pt-4">
              <span className="text-gray-500 text-xs">{scriptData ? scriptData.split("\n").length : 0} linhas</span>
              <div className="flex gap-2">
                <button onClick={() => setShowScriptModal(false)} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">Fechar</button>
                <button
                  onClick={copyToClipboard}
                  className={`px-4 py-2 text-white rounded font-medium transition-colors ${scriptCopiado ? "bg-green-600 hover:bg-green-500" : "bg-blue-600 hover:bg-blue-500"}`}
                >
                  {scriptCopiado ? "Copiado!" : "Copiar script"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </AdminLayout>
  );
}
