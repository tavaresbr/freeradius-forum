import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { Download, ChevronLeft, ChevronRight, Search } from "lucide-react";

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === 0) return "0 B";
  const num = Number(bytes);
  if (isNaN(num)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = num;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "-";
  const s = Number(seconds);
  if (isNaN(s) || s < 0) return "-";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function SessoesLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);

  // Filter state
  const [username, setUsername] = useState("");
  const [mac, setMac] = useState("");
  const [ip, setIp] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const token = localStorage.getItem("admin_token");

  const buildParams = (extraPage) => {
    const params = new URLSearchParams();
    if (username.trim()) params.set("username", username.trim());
    if (mac.trim()) params.set("mac", mac.trim());
    if (ip.trim()) params.set("ip", ip.trim());
    if (dataInicio) params.set("data_inicio", dataInicio);
    if (dataFim) params.set("data_fim", dataFim);
    if (extraPage !== undefined) {
      params.set("page", extraPage);
      params.set("per_page", perPage);
    }
    return params;
  };

  const fetchLogs = async (p = page) => {
    try {
      setLoading(true);
      const params = buildParams(p);
      const res = await fetch(`/api/radius-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setLogs(Array.isArray(json.data) ? json.data : []);
      setTotal(json.total || 0);
      setPage(json.page || 1);
    } catch (err) {
      console.error("Erro ao buscar logs:", err);
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLogs(1);
  };

  const handleClear = () => {
    setUsername("");
    setMac("");
    setIp("");
    setDataInicio("");
    setDataFim("");
    setPage(1);
    setTimeout(() => fetchLogs(1), 0);
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const goPage = (p) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
    fetchLogs(p);
  };

  const exportCSV = () => {
    const params = buildParams();
    const url = `/api/radius-logs/export?${params.toString()}`;
    const a = document.createElement("a");
    // Use fetch to include auth header, then trigger download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = "radius-logs.csv";
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => console.error("Erro ao exportar CSV:", err));
  };

  const inputClass =
    "w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500 text-sm";

  return (
    <AdminLayout>
      <div className="p-6 bg-[#0f111a] min-h-screen text-white">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Sessoes RADIUS</h1>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm"
            title="Exportar CSV"
          >
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        </div>

        {/* Search Form */}
        <form onSubmit={handleFilter} className="bg-[#1a1d27] rounded-xl border border-gray-800 p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ex: 54545454545"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">MAC</label>
              <input
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                placeholder="Ex: AA:BB:CC:DD:EE:FF"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">IP</label>
              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Ex: 10.0.0.1"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data Inicio</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data Fim</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm"
              >
                <Search className="w-4 h-4" /> Filtrar
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 rounded border border-gray-700 text-gray-300 hover:bg-[#151821] text-sm"
              >
                Limpar
              </button>
            </div>
          </div>
        </form>

        {/* Results Table */}
        <div className="overflow-auto rounded-lg border border-gray-800">
          <table className="min-w-full text-sm text-gray-300">
            <thead className="bg-[#151821] text-left text-xs font-semibold uppercase">
              <tr>
                <th className="p-3">Username</th>
                <th className="p-3">MAC</th>
                <th className="p-3">IP</th>
                <th className="p-3">NAS IP</th>
                <th className="p-3">NAS Nome</th>
                <th className="p-3">AP / SSID</th>
                <th className="p-3">Conectado em</th>
                <th className="p-3">Desconectado em</th>
                <th className="p-3">Duracao</th>
                <th className="p-3">Bytes Entrada</th>
                <th className="p-3">Bytes Saida</th>
                <th className="p-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="p-6 text-center text-gray-500">
                    Carregando...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-6 text-center text-gray-500">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                logs.map((r, i) => (
                  <tr
                    key={`${r.username}-${r.conectado_em}-${i}`}
                    className="border-b border-gray-800 hover:bg-[#151821]"
                  >
                    <td className="p-3 font-medium dado-sensivel">{r.username || "-"}</td>
                    <td className="p-3 dado-sensivel">{r.mac || "-"}</td>
                    <td className="p-3 dado-sensivel">{r.ip || "-"}</td>
                    <td className="p-3 dado-sensivel">{r.nas_ip || "-"}</td>
                    <td className="p-3 dado-sensivel">{r.nas_nome || "-"}</td>
                    <td className="p-3 text-xs">
                      {!r.ap_nome && !r.ap_mac && !r.ssid && "-"}
                      {r.ap_nome && <div className="text-white dado-sensivel">{r.ap_nome}</div>}
                      {r.ap_mac && <div className="font-mono text-gray-500 dado-sensivel">{r.ap_mac}</div>}
                      {r.ssid && <div className="text-gray-500 dado-sensivel">{r.ssid}</div>}
                    </td>
                    <td className="p-3">{fmtDateTime(r.conectado_em)}</td>
                    <td className="p-3">{fmtDateTime(r.desconectado_em)}</td>
                    <td className="p-3">{formatDuration(r.segundos_conectado)}</td>
                    <td className="p-3">{formatBytes(r.bytes_entrada)}</td>
                    <td className="p-3">{formatBytes(r.bytes_saida)}</td>
                    <td className="p-3">{r.motivo_desconexao || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>
            Total: {total} registros | Pagina {page} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-2 rounded border border-gray-700 hover:bg-[#151821] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </button>
            <button
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded border border-gray-700 hover:bg-[#151821] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Proximo <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
