import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function LgpdCadastros() {
  const [registros, setRegistros] = useState([]);
  const [filteredRegistros, setFilteredRegistros] = useState([]);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const FILTROS_VAZIOS = { origem: "", aceite: "", de: "", ate: "", ap: "", ssid: "" };
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [opcoes, setOpcoes] = useState({ origens: [], ssids: [], aps: [] });

  const token = localStorage.getItem("admin_token");

  const filtrosAtivos = Object.values(filtros).some(Boolean);
  const queryFiltros = () => {
    const p = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  };
  const mudaFiltro = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  useEffect(() => {
    fetch("/api/lgpd/filtros", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setOpcoes(d); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setErro("");
        const qs = queryFiltros();
        const res = await fetch(`/api/lgpd${qs ? `?${qs}` : ""}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.message);
        setRegistros(data);
        setFilteredRegistros(data);
      } catch (err) {
        setErro(err.message || "Erro ao buscar registros LGPD");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token, filtros]);

  useEffect(() => {
    const filtered = registros.filter((r) => {
      const searchTerm = busca.toLowerCase();
      return (
        r.nome?.toLowerCase().includes(searchTerm) ||
        r.email?.toLowerCase().includes(searchTerm) ||
        r.cpf?.includes(searchTerm) ||
        r.telefone?.includes(searchTerm)
      );
    });
    setFilteredRegistros(filtered);
  }, [busca, registros]);

  // Export com token curto de download (mesmo padrao da tela de Leads).
  // O CSV inclui o snapshot do termo aceito — prova de consentimento LGPD.
  const handleExport = async () => {
    try {
      const r = await fetch("/api/auth/download-token?para=leads", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("token");
      const { token: dl } = await r.json();
      const qs = queryFiltros();
      window.open(`/api/lgpd/export?token=${dl}${qs ? `&${qs}` : ""}`, "_blank");
    } catch (err) {
      console.error("Erro ao exportar LGPD:", err);
      alert("Não foi possível exportar. Faça login novamente.");
    }
  };

  const ORIGEM_LABELS = {
    lgpd: { label: "Portal LGPD", cls: "bg-blue-900/30 text-blue-400" },
    portal_lead: { label: "Portal Lead", cls: "bg-purple-900/30 text-purple-400" },
    portal_planos: { label: "Portal Planos", cls: "bg-emerald-900/30 text-emerald-400" },
  };

  const maskCPF = (cpf) => {
    if (!cpf) return "---";
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.***.***-$2");
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const stats = {
    total: registros.length,
    aceitos: registros.filter((r) => r.aceite).length,
    recusados: registros.filter((r) => !r.aceite).length
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Cadastros LGPD</h1>
              <p className="text-sm text-gray-400">Gerenciamento de consentimentos e dados pessoais</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded shadow text-sm font-medium cursor-pointer"
          >
            {filtrosAtivos ? "Exportar CSV (filtrado)" : "Exportar CSV"}
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-blue-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Total de Registros</div>
            <div className="text-2xl font-bold text-white">{stats.total}</div>
          </div>
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-green-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Aceites</div>
            <div className="text-2xl font-bold text-green-400">{stats.aceitos}</div>
          </div>
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-red-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Recusados</div>
            <div className="text-2xl font-bold text-red-400">{stats.recusados}</div>
          </div>
        </div>

        {/* Search */}
        <div className="bg-[#1a1d27] rounded-lg border border-gray-800 p-6">
          <div className="relative">
            <svg className="absolute left-3 top-3 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              placeholder="Buscar por nome, email, CPF ou telefone..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs text-gray-400">Origem
              <select value={filtros.origem} onChange={mudaFiltro("origem")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Todas</option>
                {opcoes.origens.map((o) => <option key={o} value={o}>{(ORIGEM_LABELS[o] || { label: o }).label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-gray-400">Status do aceite
              <select value={filtros.aceite} onChange={mudaFiltro("aceite")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Todos</option>
                <option value="1">Aceitos</option>
                <option value="0">Recusados</option>
              </select>
            </label>
            <label className="block text-xs text-gray-400">Ponto de acesso
              <select value={filtros.ap} onChange={mudaFiltro("ap")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Todos</option>
                {opcoes.aps.map((a) => <option key={a.ap_mac} value={a.ap_mac}>{a.ap_nome ? `${a.ap_nome} (${a.ap_mac})` : a.ap_mac}</option>)}
              </select>
            </label>
            <label className="block text-xs text-gray-400">SSID
              <select value={filtros.ssid} onChange={mudaFiltro("ssid")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Todos</option>
                {opcoes.ssids.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block text-xs text-gray-400">De
              <input type="date" value={filtros.de} max={filtros.ate || undefined} onChange={mudaFiltro("de")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <label className="block text-xs text-gray-400">Até
              <input type="date" value={filtros.ate} min={filtros.de || undefined} onChange={mudaFiltro("ate")} className="w-full px-3 py-2 bg-[#0d1117] border border-gray-700 text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
          </div>
          {filtrosAtivos && (
            <button type="button" onClick={() => setFiltros(FILTROS_VAZIOS)} className="mt-3 text-sm text-blue-400 hover:text-blue-300">
              Limpar filtros
            </button>
          )}
        </div>

        {/* Error Alert */}
        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            <span>{erro}</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-[#1a1d27] rounded-lg border border-gray-800 overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-400 mt-4">Carregando registros...</p>
            </div>
          ) : filteredRegistros.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              </svg>
              <h3 className="text-lg font-semibold text-white mb-2">Nenhum registro encontrado</h3>
              <p className="text-sm text-gray-400">
                {busca ? "Tente ajustar sua busca" : "Ainda não há cadastros LGPD"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#151821] border-b border-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                        </svg>
                        Nome
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                        Email
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                        </svg>
                        Telefone
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">CPF</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        </svg>
                        MAC
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        IP
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
                        </svg>
                        AP
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Origem</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Aceite em</th>
                  </tr>
                </thead>
                <tbody className="bg-[#1a1d27] divide-y divide-gray-800">
                  {filteredRegistros.map((r) => (
                    <tr key={r.id} className="hover:bg-[#252b3b] transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-white">{r.nome || "---"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-400">{r.email || "---"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-400">{r.telefone || "---"}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-white">{maskCPF(r.cpf)}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-400">{r.mac || "---"}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-400">{r.ip || "---"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        {!r.ap_nome && !r.ap_mac && !r.ssid && <span className="text-gray-400">---</span>}
                        {r.ap_nome && <div className="text-white">{r.ap_nome}</div>}
                        {r.ap_mac && <div className="font-mono text-gray-500">{r.ap_mac}</div>}
                        {r.ssid && <div className="text-gray-500">{r.ssid}</div>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${(ORIGEM_LABELS[r.origem] || { cls: "bg-gray-800 text-gray-400" }).cls}`}>
                          {(ORIGEM_LABELS[r.origem] || { label: r.origem || "---" }).label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {r.aceite ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-400">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                            </svg>
                            Aceito
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-red-900/30 text-red-400">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                            </svg>
                            Recusado
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{formatDate(r.lgpd_aceite_em || r.criado_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        {filteredRegistros.length > 0 && (
          <div className="text-sm text-gray-400 text-center pb-4">
            Exibindo {filteredRegistros.length} de {registros.length} registros
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
