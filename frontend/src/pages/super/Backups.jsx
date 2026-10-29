import { useState, useEffect, useRef } from "react";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function Backups() {
  const raizRef = useRef(null);
  useTabelasMobile(raizRef);
  const { user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success' | 'error', text: string }

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate(`/admin/${user?.empresa_slug || "default"}`);
      return;
    }
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/system-backup", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBackups(Array.isArray(data) ? data : data.backups || []);
      } else {
        setMessage({ type: "error", text: "Erro ao carregar backups." });
      }
    } catch (err) {
      console.error("Erro ao buscar backups:", err);
      setMessage({ type: "error", text: "Erro de conexão ao buscar backups." });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/system-backup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Backup criado com sucesso!" });
        fetchBackups();
      } else {
        setMessage({ type: "error", text: data.error || "Erro ao criar backup." });
      }
    } catch (err) {
      console.error("Erro ao criar backup:", err);
      setMessage({ type: "error", text: "Erro de conexão ao criar backup." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (backup) => {
    const confirmed = confirm(
      `Tem certeza que deseja restaurar o backup "${backup.id || backup.filename}"?\n\nEsta ação irá sobrescrever os dados atuais. O sistema será reiniciado após a restauração.`
    );
    if (!confirmed) return;

    setActionLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch(`/api/system-backup/restore/${backup.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: "Restauração iniciada com sucesso! A página será recarregada em 10 segundos...",
        });
        setTimeout(() => {
          window.location.reload();
        }, 10000);
      } else {
        setMessage({ type: "error", text: data.error || "Erro ao restaurar backup." });
      }
    } catch (err) {
      console.error("Erro ao restaurar backup:", err);
      setMessage({ type: "error", text: "Erro de conexão ao restaurar backup." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (backup) => {
    const confirmed = confirm(
      `Tem certeza que deseja remover o backup "${backup.id || backup.filename}"?\n\nEsta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    setActionLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch(`/api/system-backup/${backup.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Backup removido com sucesso!" });
        fetchBackups();
      } else {
        setMessage({ type: "error", text: data.error || "Erro ao remover backup." });
      }
    } catch (err) {
      console.error("Erro ao remover backup:", err);
      setMessage({ type: "error", text: "Erro de conexão ao remover backup." });
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getTipoBadge = (tipo) => {
    if (tipo === "pre_update" || tipo === "pre-atualizacao" || tipo === "pre_atualizacao") {
      return (
        <span className="px-2 py-1 rounded text-xs bg-cyan-900/30 text-cyan-400 border border-cyan-800/40">
          Pré-Atualização
        </span>
      );
    }
    return (
      <span className="px-2 py-1 rounded text-xs bg-gray-700/50 text-gray-400 border border-gray-700/40">
        Manual
      </span>
    );
  };

  const hasFiles = (backup) => {
    return backup.db_exists !== false && backup.files_exists !== false;
  };

  return (
    <div ref={raizRef} className="super-pagina min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Backups do Sistema</h1>
            <p className="text-gray-500 mt-1">Gerencie os backups de banco de dados e arquivos</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate("/super")}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
            >
              Voltar
            </button>
            <button
              onClick={handleCreateBackup}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? "Aguarde..." : "Criar Backup"}
            </button>
          </div>
        </div>

        {/* Status message */}
        {message && (
          <div
            className={`mb-6 px-4 py-3 rounded-lg border text-sm ${
              message.type === "success"
                ? "bg-green-900/20 border-green-700/40 text-green-400"
                : "bg-red-900/20 border-red-700/40 text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Backup list */}
        {loading ? (
          <p className="text-gray-500">Carregando backups...</p>
        ) : backups.length === 0 ? (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-12 text-center">
            <p className="text-gray-500 text-lg">Nenhum backup encontrado.</p>
            <p className="text-gray-600 text-sm mt-2">
              Clique em "Criar Backup" para gerar o primeiro backup do sistema.
            </p>
          </div>
        ) : (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left p-4">Tipo</th>
                  <th className="text-left p-4">Atualização</th>
                  <th className="text-left p-4">Data</th>
                  <th className="text-center p-4">Banco de Dados</th>
                  <th className="text-center p-4">Arquivos</th>
                  <th className="text-center p-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => {
                  const filesOk = hasFiles(backup);
                  return (
                    <tr
                      key={backup.id}
                      className="border-b border-gray-800/50 hover:bg-[#252b3b]"
                    >
                      <td className="p-4">{getTipoBadge(backup.tipo || backup.type)}</td>
                      <td className="p-4 text-gray-400 text-xs">
                        {backup.update_id ? (
                          <span className="font-mono">{backup.update_id}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="p-4 text-gray-300">
                        {formatDate(backup.criado_em || backup.created_at || backup.date)}
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            backup.db_exists !== false
                              ? "bg-green-900/30 text-green-400"
                              : "bg-red-900/30 text-red-400"
                          }`}
                        >
                          {backup.db_exists !== false ? "OK" : "Ausente"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            filesOk
                              ? "bg-green-900/30 text-green-400"
                              : "bg-gray-700/50 text-gray-500"
                          }`}
                        >
                          {filesOk ? "OK" : "Ausente"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleRestore(backup)}
                            disabled={actionLoading || !filesOk}
                            title={!filesOk ? "Arquivos ausentes — restauração indisponível" : "Restaurar este backup"}
                            className="px-3 py-1 bg-yellow-600/20 text-yellow-400 rounded hover:bg-yellow-600/30 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Restaurar
                          </button>
                          <button
                            onClick={() => handleDelete(backup)}
                            disabled={actionLoading}
                            className="px-3 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Emergency info */}
        <div className="mt-8 bg-yellow-900/10 border border-yellow-800/30 rounded-xl p-5">
          <p className="text-yellow-400 font-semibold text-sm mb-1">Acesso de Emergência</p>
          <p className="text-yellow-200/70 text-sm">
            Se o sistema estiver inacessível após uma restauração ou atualização, utilize o endpoint
            de emergência diretamente no servidor:
          </p>
          <code className="block mt-2 bg-[#0f111a] border border-yellow-800/20 text-yellow-300 text-xs px-3 py-2 rounded font-mono">
            http://servidor:3001/emergency
          </code>
          <p className="text-yellow-200/50 text-xs mt-2">
            Este endpoint permite acesso direto ao backend mesmo quando o frontend estiver indisponível.
          </p>
        </div>
      </div>
    </div>
  );
}
