import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import ToggleTema from "../../components/ToggleTema";

export default function AtualizarSistema() {
  const { user, isSuperAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("email"); // email | checking | updates | applying | done | error
  const [email, setEmail] = useState("");
  const [updates, setUpdates] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [doneMsg, setDoneMsg] = useState("");
  const [applyProgress, setApplyProgress] = useState({ current: 0, total: 0 });
  const [lastAppliedId, setLastAppliedId] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsData, setLogsData] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const reloadTimerRef = useRef(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate(`/admin/${user?.empresa_slug || "default"}`);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const handleCheck = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStep("checking");
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/system-update/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorized) {
        setErrorMsg(data.message || "Assinatura nao autorizada ou email invalido.");
        setStep("error");
        return;
      }
      if (!data.updates || data.updates.length === 0) {
        setDoneMsg("Seu sistema ja esta na versao mais recente. Nenhuma atualizacao disponivel.");
        setStep("done");
        return;
      }
      setUpdates(data.updates);
      setStep("updates");
    } catch (err) {
      setErrorMsg("Erro ao verificar atualizacoes. Verifique sua conexao e tente novamente.");
      setStep("error");
    }
  };

  const fetchLogs = async (updateId) => {
    setLogsLoading(true);
    setLogsData([]);
    setLogsOpen(true);
    try {
      const token = localStorage.getItem("admin_token");
      const url = updateId
        ? `/api/system-update/logs?update_id=${encodeURIComponent(updateId)}`
        : "/api/system-update/logs";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLogsData(Array.isArray(data.logs) ? data.logs : []);
      } else {
        setLogsData([
          {
            id: 0,
            step: "error",
            status: "erro",
            message: data.message || "Falha ao carregar logs",
            criado_em: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setLogsData([
        {
          id: 0,
          step: "error",
          status: "erro",
          message: "Erro de conexao ao carregar logs",
          criado_em: new Date().toISOString(),
        },
      ]);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleApply = async () => {
    setStep("applying");
    const total = updates.length;
    setApplyProgress({ current: 0, total });

    const token = localStorage.getItem("admin_token");

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      setApplyProgress({ current: i + 1, total });
      setLastAppliedId(update.id);
      const isLast = i === updates.length - 1;

      try {
        const res = await fetch("/api/system-update/apply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email: email.trim(), update_id: update.id }),
        });

        let data = null;
        try {
          data = await res.json();
        } catch {
          // Conexao perdida ao ler resposta - se for a ultima, PM2 reiniciou
          if (isLast) {
            setDoneMsg(
              "Atualizacao aplicada com sucesso! O servidor foi reiniciado. A pagina sera recarregada automaticamente."
            );
            setStep("done");
            reloadTimerRef.current = setTimeout(() => window.location.reload(), 8000);
            return;
          }
          setErrorMsg(
            `Conexao perdida ao aplicar a atualizacao ${update.id}. Recomendamos verificar o estado do sistema e restaurar um backup se necessario.`
          );
          setStep("error");
          return;
        }

        if (!res.ok || !data.success) {
          // Se for a ultima e o backend respondeu antes de reiniciar, pode ser falso negativo
          if (isLast && data?.applied) {
            setDoneMsg(
              data.message || "Atualizacoes aplicadas com sucesso! A pagina sera recarregada em 8 segundos."
            );
            setStep("done");
            reloadTimerRef.current = setTimeout(() => window.location.reload(), 8000);
            return;
          }
          setErrorMsg(
            (data?.message || `Falha ao aplicar atualizacao "${update.descricao}".`) +
              (isLast ? "" : " Recomendamos restaurar o backup automatico criado antes desta operacao.")
          );
          setStep("error");
          return;
        }

        // Sucesso explícito
        if (isLast) {
          setDoneMsg(
            data.message || "Todas as atualizacoes foram aplicadas com sucesso! A pagina sera recarregada em 8 segundos."
          );
          setStep("done");
          reloadTimerRef.current = setTimeout(() => window.location.reload(), 8000);
          return;
        }
      } catch (err) {
        // Erro de rede (fetch falhou completamente)
        if (isLast) {
          setDoneMsg(
            "Atualizacao aplicada com sucesso! O servidor foi reiniciado. A pagina sera recarregada automaticamente."
          );
          setStep("done");
          reloadTimerRef.current = setTimeout(() => window.location.reload(), 8000);
          return;
        }
        setErrorMsg(
          `Erro de conexao ao aplicar a atualizacao "${update.descricao}". Recomendamos restaurar o backup automatico criado antes desta operacao.`
        );
        setStep("error");
        return;
      }
    }
  };

  const handleReset = () => {
    setStep("email");
    setErrorMsg("");
    setDoneMsg("");
    setUpdates([]);
    setApplyProgress({ current: 0, total: 0 });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const progressPercent =
    applyProgress.total > 0
      ? Math.round((applyProgress.current / applyProgress.total) * 100)
      : 0;

  return (
    <div className="super-pagina painel min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Atualizar Sistema</h1>
            <p className="text-gray-500 mt-1">Verifique e aplique atualizacoes da plataforma</p>
          </div>
          <div className="flex items-center gap-3">
            <ToggleTema className="text-gray-400" />
            <Link
              to="/super"
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
            >
              Voltar
            </Link>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 text-sm"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Step: email */}
        {step === "email" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 sm:p-8">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white">Verificar Atualizacoes</h2>
              </div>
              <p className="text-gray-400 text-sm">
                Informe o email cadastrado no Hotmart para validar sua assinatura e verificar se ha atualizacoes disponiveis.
              </p>
            </div>

            <form onSubmit={handleCheck} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Email Hotmart
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Verificar Atualizacoes
              </button>
            </form>
          </div>
        )}

        {/* Step: checking */}
        {step === "checking" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-12 flex flex-col items-center gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <p className="text-white text-lg font-semibold">Verificando atualizacoes...</p>
              <p className="text-gray-500 text-sm mt-1">Validando sua assinatura</p>
            </div>
          </div>
        )}

        {/* Step: updates */}
        {step === "updates" && (
          <div className="space-y-4">
            {/* Info box */}
            <div className="bg-blue-600/10 border border-blue-500/30 rounded-xl p-4 flex gap-3">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-blue-300 text-sm">
                Um backup automatico sera criado antes de aplicar as atualizacoes. Voce pode restaura-lo na pagina de Backups caso necessario.
              </p>
            </div>

            {/* Updates list */}
            <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800">
                <h2 className="text-white font-semibold">
                  {updates.length} {updates.length === 1 ? "atualizacao disponivel" : "atualizacoes disponiveis"}
                </h2>
              </div>
              <div className="divide-y divide-gray-800">
                {updates.map((update, idx) => (
                  <div key={update.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <span className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <p className="text-white font-medium text-sm">{update.descricao}</p>
                          {update.changelog && (
                            <p className="text-gray-500 text-xs mt-1 leading-relaxed">{update.changelog}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-xs text-gray-600 font-mono">{update.id}</span>
                        {update.date && (
                          <p className="text-xs text-gray-600 mt-0.5">{formatDate(update.date)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-3 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleApply}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Aplicar Todas
              </button>
            </div>
          </div>
        )}

        {/* Step: applying */}
        {step === "applying" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 sm:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 border-3 border-gray-700 border-t-green-500 rounded-full animate-spin flex-shrink-0" style={{ borderWidth: "3px" }}></div>
              <div>
                <p className="text-white font-semibold">Aplicando atualizacoes...</p>
                <p className="text-gray-500 text-sm">
                  {applyProgress.current > 0
                    ? `Atualizacao ${applyProgress.current} de ${applyProgress.total}`
                    : "Iniciando..."}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>{applyProgress.current} de {applyProgress.total} aplicadas</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-yellow-600/10 border border-yellow-500/30 rounded-lg p-4 flex gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-yellow-300 text-sm font-medium">
                Nao feche esta pagina. O processo pode reiniciar o servidor automaticamente.
              </p>
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 sm:p-8 space-y-6">
            <div className="bg-green-600/10 border border-green-500/30 rounded-xl p-6 flex gap-4">
              <div className="w-10 h-10 rounded-full bg-green-600/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-green-300 font-semibold text-lg">Sucesso!</p>
                <p className="text-green-400/80 text-sm mt-1">{doneMsg}</p>
              </div>
            </div>

            <div className="text-center">
              <p className="text-gray-500 text-sm">A pagina sera recarregada automaticamente em 8 segundos.</p>
              <div className="mt-4 flex gap-3 justify-center flex-wrap">
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Recarregar Agora
                </button>
                <button
                  onClick={() => fetchLogs(lastAppliedId)}
                  className="px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-sm font-medium transition-colors"
                >
                  Ver Logs
                </button>
                <Link
                  to="/super"
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition-colors"
                >
                  Ir para o Painel
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Step: error */}
        {step === "error" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 sm:p-8 space-y-6">
            <div className="bg-red-600/10 border border-red-500/30 rounded-xl p-6 flex gap-4">
              <div className="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="text-red-300 font-semibold text-lg">Erro na atualizacao</p>
                <p className="text-red-400/80 text-sm mt-1">{errorMsg}</p>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleReset}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Tentar Novamente
              </button>
              <button
                onClick={() => fetchLogs(lastAppliedId)}
                className="flex-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-semibold py-3 rounded-lg transition-colors"
              >
                Ver Logs
              </button>
              <Link
                to="/super/backups"
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-3 rounded-lg transition-colors text-center"
              >
                Ir para Backups
              </Link>
            </div>
          </div>
        )}

        {/* Logs Modal */}
        {logsOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setLogsOpen(false)}
          >
            <div
              className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 max-w-3xl w-full max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white text-lg font-semibold">
                  Logs do Apply
                  {lastAppliedId && (
                    <span className="ml-2 text-xs text-gray-500 font-mono">
                      #{lastAppliedId}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => setLogsOpen(false)}
                  className="text-gray-500 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#0d1117] border border-gray-800 rounded-lg p-3 font-mono text-xs">
                {logsLoading ? (
                  <p className="text-gray-500">Carregando...</p>
                ) : logsData.length === 0 ? (
                  <p className="text-gray-500">
                    Nenhum log encontrado para este update.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {logsData.map((l) => {
                      const color =
                        l.status === "erro"
                          ? "text-red-400"
                          : l.status === "ok"
                          ? "text-green-400"
                          : "text-blue-400";
                      const ts = new Date(l.criado_em).toLocaleTimeString(
                        "pt-BR"
                      );
                      return (
                        <div key={l.id} className="flex gap-2">
                          <span className="text-gray-600 shrink-0">{ts}</span>
                          <span className={`shrink-0 w-14 ${color}`}>
                            [{l.status}]
                          </span>
                          <span className="shrink-0 w-24 text-gray-400">
                            {l.step}
                          </span>
                          <span className="text-gray-300 break-all">
                            {l.message}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => fetchLogs(lastAppliedId)}
                  className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded text-sm"
                >
                  Recarregar
                </button>
                <button
                  onClick={() => setLogsOpen(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
