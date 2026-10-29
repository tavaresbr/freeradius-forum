import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Pagamentos() {
  const [pagamentos, setPagamentos] = useState([]);
  const [filtro, setFiltro] = useState("todos");
  const [ordenarPor, setOrdenarPor] = useState("id");
  const [ordemAsc, setOrdemAsc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const fetchPagamentos = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/pagamentos/todos", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
      });
      const data = await res.json();
      setPagamentos(data);
    } catch (err) {
      console.error("Erro ao buscar pagamentos:", err);
      setErro("Erro ao carregar pagamentos");
    } finally {
      setLoading(false);
    }
  };

  const liberarManual = async (id) => {
    if (!window.confirm("Deseja liberar este cliente manualmente?")) return;
    try {
      await fetch(`/api/pagamentos/liberar/${id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
      });
      alert("Usuário liberado com sucesso!");
      fetchPagamentos(); // Recarrega a lista
    } catch (err) {
      console.error("Erro ao liberar manualmente:", err);
      alert("Erro ao liberar.");
    }
  };

  useEffect(() => {
    fetchPagamentos();
  }, []);

  const toggleOrdenacao = (campo) => {
    if (ordenarPor === campo) {
      setOrdemAsc(!ordemAsc);
    } else {
      setOrdenarPor(campo);
      setOrdemAsc(true);
    }
  };

  const pagamentosFiltrados = pagamentos.filter((p) => {
    if (filtro === "todos") return true;
    if (filtro === "aprovados") return p.status.toLowerCase() === "approved";
    if (filtro === "pendentes") return p.status.toLowerCase() === "aguardando";
    return true;
  });

  const pagamentosOrdenados = [...pagamentosFiltrados].sort((a, b) => {
    if (ordemAsc) return a[ordenarPor] > b[ordenarPor] ? 1 : -1;
    else return a[ordenarPor] < b[ordenarPor] ? 1 : -1;
  });

  const badgeStatus = (status) => {
    const lower = status.toLowerCase();
    if (lower === "approved") {
      return (
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          Aprovado
        </span>
      );
    }
    if (lower === "aguardando") {
      return (
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-yellow-900/30 text-yellow-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
          </svg>
          Aguardando
        </span>
      );
    }
    return <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-400">{status}</span>;
  };

  const stats = {
    total: pagamentos.length,
    aprovados: pagamentos.filter((p) => p.status.toLowerCase() === "approved").length,
    pendentes: pagamentos.filter((p) => p.status.toLowerCase() === "aguardando").length,
    totalValor: pagamentos
      .filter((p) => p.status.toLowerCase() === "approved")
      .reduce((acc, p) => acc + (p.valor || 0), 0) / 100
  };

  const SortIcon = ({ campo }) => {
    if (ordenarPor !== campo) return null;
    return ordemAsc ? (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"/>
      </svg>
    ) : (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"/>
      </svg>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Pagamentos</h1>
              <p className="text-sm text-gray-400">Gerenciamento de transações e cobranças</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-blue-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Total de Pagamentos</div>
            <div className="text-2xl font-bold text-white">{stats.total}</div>
          </div>
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-green-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Aprovados</div>
            <div className="text-2xl font-bold text-green-400">{stats.aprovados}</div>
          </div>
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-yellow-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Pendentes</div>
            <div className="text-2xl font-bold text-yellow-400">{stats.pendentes}</div>
          </div>
          <div className="bg-[#1a1d27] rounded-lg border border-gray-800 border border-emerald-800/30 p-6">
            <div className="text-sm font-medium text-gray-400 mb-2">Valor Aprovado</div>
            <div className="text-2xl font-bold text-emerald-400">
              R$ {stats.totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-[#1a1d27] rounded-lg border border-gray-800 p-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setFiltro("todos")}
              className={`
                px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2
                ${filtro === "todos" 
                  ? "bg-blue-600 text-white" 
                  : "bg-[#252b3b] text-gray-300 hover:opacity-80"
                }
              `}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
              </svg>
              Todos
            </button>
            <button
              onClick={() => setFiltro("aprovados")}
              className={`
                px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2
                ${filtro === "aprovados" 
                  ? "bg-green-600 text-white shadow-md" 
                  : "bg-[#252b3b] text-gray-300 hover:opacity-80"
                }
              `}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              Aprovados
            </button>
            <button
              onClick={() => setFiltro("pendentes")}
              className={`
                px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2
                ${filtro === "pendentes" 
                  ? "bg-yellow-500 text-white shadow-md" 
                  : "bg-[#252b3b] text-gray-300 hover:opacity-80"
                }
              `}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
              </svg>
              Pendentes
            </button>
          </div>
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
              <p className="text-gray-400 mt-4">Carregando pagamentos...</p>
            </div>
          ) : pagamentosOrdenados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
              </svg>
              <h3 className="text-lg font-semibold text-white mb-2">Nenhum pagamento encontrado</h3>
              <p className="text-sm text-gray-400">
                {filtro !== "todos" ? "Tente outro filtro" : "Ainda não há pagamentos registrados"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#151821] border-b border-gray-800">
                  <tr>
                    <th 
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#252b3b] transition-colors"
                      onClick={() => toggleOrdenacao("id")}
                    >
                      <div className="flex items-center gap-2">
                        ID
                        <SortIcon campo="id" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#252b3b] transition-colors"
                      onClick={() => toggleOrdenacao("nome_plano")}
                    >
                      <div className="flex items-center gap-2">
                        Plano
                        <SortIcon campo="nome_plano" />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">MAC</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">IP</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">ID MP</th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#252b3b] transition-colors"
                      onClick={() => toggleOrdenacao("valor")}
                    >
                      <div className="flex items-center gap-2">
                        Valor
                        <SortIcon campo="valor" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#252b3b] transition-colors"
                      onClick={() => toggleOrdenacao("status")}
                    >
                      <div className="flex items-center gap-2">
                        Status
                        <SortIcon campo="status" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#252b3b] transition-colors"
                      onClick={() => toggleOrdenacao("criado_em")}
                    >
                      <div className="flex items-center gap-2">
                        Data
                        <SortIcon campo="criado_em" />
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Ação</th>
                  </tr>
                </thead>
                <tbody className="bg-[#1a1d27] divide-y divide-gray-800">
                  {pagamentosOrdenados.map((p) => (
                    <tr key={p.id} className="hover:bg-[#252b3b] transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-white">#{p.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-white font-medium">{p.nome_plano}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-400">{p.mac || "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-400">{p.ip || "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-400">{p.mp_pagamento_id ?? "-"}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-semibold text-white">
                        R$ {(p.valor / 100).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{badgeStatus(p.status)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {new Date(p.criado_em).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => liberarManual(p.id)}
                          className="inline-flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors duration-200 shadow-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/>
                          </svg>
                          Liberar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        {pagamentosOrdenados.length > 0 && (
          <div className="text-sm text-gray-400 text-center pb-4">
            Exibindo {pagamentosOrdenados.length} de {pagamentos.length} pagamentos
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
