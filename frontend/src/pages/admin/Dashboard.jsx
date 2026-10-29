import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Dashboard() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");

  const token = localStorage.getItem("admin_token");

  const carregarDados = async () => {
    try {
      const res = await fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json().catch(() => ({}));
      // Resposta de erro (403 sem grupo de permissao, 402 assinatura, 500...) nao tem os
      // totais: antes ia direto para `dados` e o Dashboard quebrava (tela branca).
      if (!res.ok || !json.pagamentos) {
        setErro(json.message || json.error || "Erro ao carregar dashboard");
        return;
      }
      setDados(json);
    } catch (err) {
      setErro("Erro ao carregar dashboard");
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const cards = dados ? [
    {
      title: "Pagamentos (24h)",
      value: dados.pagamentos.ultimas_24h,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
      ),
      color: "text-green-400",
      bg: "bg-green-500/10",
      border: "border-green-500/20"
    },
    {
      title: "Pagamentos (total)",
      value: dados.pagamentos.total,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
      ),
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20"
    },
    {
      title: "Usuários Radius",
      value: dados.radius.total_usuarios,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
      ),
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/20"
    },
    {
      title: "Mikrotiks Online",
      value: `${dados.mikrotiks.online} / ${dados.mikrotiks.total}`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path></svg>
      ),
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20"
    }
  ] : [];

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-6 sm:mb-8">
        <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      </div>

      {erro && <p className="text-red-400 mb-4">{erro}</p>}

      {!dados ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Carregando...</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            {cards.map((card, i) => (
              <div key={i} className={`bg-[#1a1d27] rounded-xl p-3 sm:p-5 border ${card.border} hover:border-gray-700 transition-all duration-200`}>
                <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
                  <p className="text-[11px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-0">{card.title}</p>
                  <div className={`${card.bg} ${card.color} p-1.5 sm:p-2 rounded-lg shrink-0 [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-6 sm:[&>svg]:h-6`}>
                    {card.icon}
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-white">{card.value}</p>
              </div>
            ))}
          </div>

          {dados?.sessoes && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <h2 className="text-lg font-semibold text-white">Sessões Ativas por Mikrotik</h2>
              </div>
              <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
                <table data-sem-cartoes className="w-full text-sm">
                  <thead className="bg-[#151821]">
                    <tr>
                      <th className="px-4 sm:px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Mikrotik</th>
                      <th className="px-4 sm:px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Conectados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {dados.sessoes.map((s, i) => (
                      <tr key={i} className="hover:bg-[#252b3b] transition-colors">
                        <td className="px-4 sm:px-6 py-3 text-gray-300 break-words">{s.nome}</td>
                        <td className="px-4 sm:px-6 py-3 text-right">
                          <span className="px-2 py-1 bg-blue-900/30 text-blue-400 text-xs font-semibold rounded">{s.conectados}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
