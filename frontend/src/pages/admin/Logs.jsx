import React, { useEffect, useRef, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const LINE_OPTIONS = [100, 250, 500, 1000, 2000, 5000];

function fmtBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function Logs() {
  const [tab, setTab] = useState("pm2");
  const [pm2Tipo, setPm2Tipo] = useState("out");
  const [linhas, setLinhas] = useState(500);
  const [filtro, setFiltro] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [conteudo, setConteudo] = useState("");
  const [meta, setMeta] = useState({ path: "", size: 0, exists: true });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [limpando, setLimpando] = useState(false);

  const preRef = useRef(null);
  const autoScrollRef = useRef(true);
  const token = localStorage.getItem("admin_token");

  const carregar = async () => {
    setLoading(true);
    setErro("");
    try {
      const url =
        tab === "pm2"
          ? `/api/logs/pm2?tipo=${pm2Tipo}&lines=${linhas}`
          : `/api/logs/radius?lines=${linhas}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setConteudo(data.content || "");
      setMeta({ path: data.path, size: data.size, exists: data.exists });
    } catch (e) {
      setErro(e.message || "Erro ao carregar logs");
    } finally {
      setLoading(false);
    }
  };

  const carregarStatus = async () => {
    try {
      const res = await fetch("/api/logs/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      // silencioso
    }
  };

  const limpar = async () => {
    const confirmMsg =
      tab === "pm2"
        ? "Tem certeza que deseja limpar os logs do PM2?"
        : "Tem certeza que deseja limpar o log do FreeRADIUS?";
    if (!window.confirm(confirmMsg)) return;
    setLimpando(true);
    try {
      const url =
        tab === "pm2" ? "/api/logs/pm2/clear" : "/api/logs/radius/clear";
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await carregar();
    } catch (e) {
      setErro(e.message || "Erro ao limpar");
    } finally {
      setLimpando(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pm2Tipo, linhas]);

  useEffect(() => {
    carregarStatus();
    const id = setInterval(carregarStatus, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(carregar, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, tab, pm2Tipo, linhas]);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    if (autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conteudo]);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    autoScrollRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  const linhasVisiveis = (() => {
    if (!conteudo) return [];
    const arr = conteudo.split("\n");
    if (!filtro) return arr;
    const f = filtro.toLowerCase();
    return arr.filter((l) => l.toLowerCase().includes(f));
  })();

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(linhasVisiveis.join("\n"));
    } catch (e) {
      setErro("Nao foi possivel copiar");
    }
  };

  const baixar = () => {
    const blob = new Blob([conteudo], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const nome =
      tab === "pm2"
        ? `pm2-${pm2Tipo}-${new Date().toISOString().slice(0, 19)}.log`
        : `radius-${new Date().toISOString().slice(0, 19)}.log`;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  };

  const corLinha = (linha) => {
    const l = linha.toLowerCase();
    if (l.includes("error") || l.includes("err ") || l.includes("erro")) return "text-red-400";
    if (l.includes("warn") || l.includes("aviso")) return "text-yellow-400";
    if (l.includes("auth:") || l.includes("login ok") || l.includes("approved") || l.includes("success")) return "text-green-400";
    if (l.includes("reject") || l.includes("negado") || l.includes("failed")) return "text-red-300";
    return "text-gray-200";
  };

  const totalLinhas = conteudo ? conteudo.split("\n").length : 0;

  return (
    <AdminLayout>
      <div className="p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Logs do Sistema</h1>
            <p className="text-sm text-gray-400">
              Acompanhe em tempo real os logs do backend (PM2) e do FreeRADIUS
            </p>
          </div>

          {status && (
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    status.pm2?.ok && status.pm2.status === "online"
                      ? "bg-green-400"
                      : "bg-red-400"
                  }`}
                />
                <span className="text-gray-300">
                  PM2: {status.pm2?.status || "?"}
                  {status.pm2?.restarts !== undefined &&
                    ` (${status.pm2.restarts} restarts)`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    status.radius?.status === "active"
                      ? "bg-green-400"
                      : "bg-red-400"
                  }`}
                />
                <span className="text-gray-300">
                  FreeRADIUS: {status.radius?.status || "?"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-4 border-b border-gray-700">
          <button
            onClick={() => setTab("pm2")}
            className={`px-4 py-2 font-medium transition ${
              tab === "pm2"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            PM2 (Backend)
          </button>
          <button
            onClick={() => setTab("radius")}
            className={`px-4 py-2 font-medium transition ${
              tab === "radius"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            FreeRADIUS
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-3">
          {tab === "pm2" && (
            <div className="flex items-center gap-1 bg-gray-900 rounded p-1">
              <button
                onClick={() => setPm2Tipo("out")}
                className={`px-3 py-1 rounded text-sm ${
                  pm2Tipo === "out"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                stdout
              </button>
              <button
                onClick={() => setPm2Tipo("error")}
                className={`px-3 py-1 rounded text-sm ${
                  pm2Tipo === "error"
                    ? "bg-red-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                stderr
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Linhas:</label>
            <select
              value={linhas}
              onChange={(e) => setLinhas(parseInt(e.target.value, 10))}
              className="bg-gray-900 text-white text-sm rounded px-2 py-1 border border-gray-700"
            >
              {LINE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            placeholder="Filtrar..."
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="bg-gray-900 text-white text-sm rounded px-3 py-1 border border-gray-700 flex-1 min-w-[140px]"
          />

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-500"
            />
            Auto-refresh (4s)
          </label>

          <div className="flex flex-wrap gap-2 ml-auto">
            <button
              onClick={carregar}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded disabled:opacity-50"
            >
              {loading ? "Carregando..." : "Atualizar"}
            </button>
            <button
              onClick={copiar}
              className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1 rounded"
            >
              Copiar
            </button>
            <button
              onClick={baixar}
              className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1 rounded"
            >
              Baixar
            </button>
            <button
              onClick={limpar}
              disabled={limpando}
              className="bg-red-700 hover:bg-red-800 text-white text-sm px-3 py-1 rounded disabled:opacity-50"
            >
              {limpando ? "Limpando..." : "Limpar"}
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-500 mb-2 flex items-center gap-4 flex-wrap">
          <span>
            Arquivo: <code className="text-gray-400">{meta.path}</code>
          </span>
          <span>Tamanho: {fmtBytes(meta.size)}</span>
          <span>
            Exibindo {linhasVisiveis.length} linhas
            {filtro ? ` (filtradas de ${totalLinhas})` : ""}
          </span>
          {!meta.exists && (
            <span className="text-yellow-400">(arquivo nao encontrado)</span>
          )}
        </div>

        {erro && (
          <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm rounded p-2 mb-3">
            {erro}
          </div>
        )}

        <div
          ref={preRef}
          onScroll={onScroll}
          className="bg-black border border-gray-700 rounded-lg p-3 h-[62vh] overflow-auto font-mono text-xs leading-relaxed"
        >
          {linhasVisiveis.length === 0 && !loading && (
            <div className="text-gray-600 italic">Sem linhas para exibir.</div>
          )}
          {linhasVisiveis.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${corLinha(l)}`}>
              {l || " "}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
