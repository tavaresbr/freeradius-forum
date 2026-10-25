// frontend/src/pages/admin/Sessoes.jsx
import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Sessoes() {
  const [sessoes, setSessoes] = useState([]);
  const [loading, setLoading] = useState(true);

  const carregarSessoes = async () => {
    try {
      const res = await fetch("/api/radius/sessoes", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar sessões");
      setSessoes(data);
    } catch (err) {
      console.error("Erro ao carregar sessões:", err);
      setSessoes([]);
    } finally {
      setLoading(false);
    }
  };

  const [agora, setAgora] = useState(Date.now());
  const [carregadoEm, setCarregadoEm] = useState(Date.now());

  useEffect(() => {
    carregarSessoes().then(() => setCarregadoEm(Date.now()));
    const recarrega = setInterval(async () => {
      await carregarSessoes();
      setCarregadoEm(Date.now());
    }, 30000);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => { clearInterval(recarrega); clearInterval(relogio); };
  }, []);

  // Contagem regressiva a partir do valor do servidor (restante_segundos) no momento do carregamento
  const formatarRestante = (s) => {
    if (s.restante_segundos == null) return "Sem limite";
    const seg = Math.max(0, Number(s.restante_segundos) - Math.floor((agora - carregadoEm) / 1000));
    if (seg === 0) return "Encerrando...";
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    const ss = seg % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min ${String(ss).padStart(2, "0")}s`;
  };

  return (
    <AdminLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Sessões RADIUS Ativas</h1>
        <div className="overflow-auto rounded-lg border border-gray-800 bg-[#1a1d27]">
          <table className="min-w-full text-sm text-white">
            <thead className="bg-[#151821] text-xs uppercase text-gray-400">
              <tr>
                <th className="p-3 text-left">Usuário</th>
                <th className="p-3 text-left">CPF</th>
                <th className="p-3 text-left">MAC</th>
                <th className="p-3 text-left">IP</th>
                <th className="p-3 text-left">NAS (Mikrotik)</th>
                <th className="p-3 text-left">Início da Sessão</th>
                <th className="p-3 text-left">Tempo restante</th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map((s, idx) => (
                <tr key={idx} className="border-t border-gray-800">
                  <td className="p-3">{s.username}</td>
                  <td className="p-3">{s.cpf || "-"}</td>
                  <td className="p-3">{s.mac || "-"}</td>
                  <td className="p-3">{s.ip || "-"}</td>
                  <td className="p-3">{s.gateway || "-"}</td>
                  <td className="p-3">{new Date(s.acctstarttime).toLocaleString("pt-BR")}</td>
                  <td className="p-3 font-medium">{formatarRestante(s)}</td>
                </tr>
              ))}
              {sessoes.length === 0 && !loading && (
                <tr>
                  <td colSpan="7" className="p-3 text-center text-gray-500">
                    Nenhuma sessão ativa no momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {loading && (
            <div className="text-center p-4 text-gray-500">Carregando sessões...</div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

