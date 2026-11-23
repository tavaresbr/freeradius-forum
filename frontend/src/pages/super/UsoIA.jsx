import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import ToggleTema from "../../components/ToggleTema";

const STATUS = {
  esgotado: ["Esgotado", "bg-red-900/30 text-red-400 border-red-800/40", 0],
  perto: ["Perto do limite", "bg-yellow-900/30 text-yellow-400 border-yellow-800/40", 1],
  ok: ["Ok", "bg-green-900/30 text-green-400 border-green-800/40", 2],
  desligada: ["IA desligada", "bg-gray-700/50 text-gray-400 border-gray-700/40", 3],
};
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
// Protecao contra formula em planilha (nome de empresa e' texto livre)
const celula = (v) => (/^[=+\-@\t\r]/.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));

export default function UsoIA() {
  const raizRef = useRef(null);
  useTabelasMobile(raizRef);
  const navigate = useNavigate();
  const [mes, setMes] = useState("");
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [soAlerta, setSoAlerta] = useState(false);
  const [ordem, setOrdem] = useState("consumo"); // consumo | nome | status

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); setErro("");
      try {
        const token = localStorage.getItem("admin_token");
        const res = await fetch(`/api/plataforma/ia-uso${mes ? `?mes=${mes}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok) { setErro(d.error || "Não foi possível carregar o uso da IA"); setDados(null); }
        else { setDados(d); if (!mes && d.mes) setMes(d.mes); }
      } catch { if (vivo) setErro("Erro de conexão"); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [mes]);

  const linhas = useMemo(() => {
    let l = (dados?.empresas || []).filter((e) => e.nome.toLowerCase().includes(busca.trim().toLowerCase()));
    if (soAlerta) l = l.filter((e) => e.status === "perto" || e.status === "esgotado");
    const cmp = {
      consumo: (a, b) => b.respostas - a.respostas || a.nome.localeCompare(b.nome),
      nome: (a, b) => a.nome.localeCompare(b.nome),
      status: (a, b) => STATUS[a.status][2] - STATUS[b.status][2] || b.respostas - a.respostas,
    }[ordem];
    return [...l].sort(cmp);
  }, [dados, busca, soAlerta, ordem]);

  const exportar = () => {
    const cab = ["Empresa", "Plano", "Respostas", "Limite", "Tokens entrada", "Tokens saída", "Situação"];
    const rows = linhas.map((e) => [e.nome, e.plano || "", e.respostas, e.limite == null ? "ilimitado" : e.limite, e.tokens_in, e.tokens_out, STATUS[e.status][0]]);
    const csv = [cab, ...rows].map((l) => l.map((c) => `"${celula(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `uso-ia-${dados?.mes || "mes"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const t = dados?.totais;
  const sel = "bg-[#1a1d27] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200";

  return (
    <div ref={raizRef} className="super-pagina painel min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Uso da IA</h1>
            <p className="text-gray-500 mt-1">Respostas e tokens por empresa. O custo da IA é da plataforma.</p>
          </div>
          <div className="flex items-center gap-3">
            <ToggleTema className="text-gray-400" />
            <button onClick={() => navigate("/super")} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">Voltar</button>
          </div>
        </div>

        {erro && <p className="text-sm text-red-400 mb-4">{erro}</p>}
        {dados?.indisponivel && <p className="text-sm text-yellow-300 mb-4">{dados.mensagem}</p>}

        {dados && !dados.indisponivel && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {[["Respostas no mês", fmt(t.respostas)], ["Empresas com uso", fmt(t.empresas_com_uso)], ["Tokens de entrada", fmt(t.tokens_in)], ["Tokens de saída", fmt(t.tokens_out)]].map(([r, v]) => (
                <div key={r} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500">{r}</p>
                  <p className="text-2xl font-bold text-white mt-1">{v}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              <select aria-label="Mês" className={sel} value={mes} onChange={(e) => setMes(e.target.value)}>
                {(dados.meses_disponiveis || [dados.mes]).map((m) => <option key={m} value={m}>{m.split("-").reverse().join("/")}</option>)}
              </select>
              <input aria-label="Buscar empresa" className={`${sel} min-w-0`} placeholder="Buscar empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <select aria-label="Ordenar" className={sel} value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                <option value="consumo">Maior consumo</option>
                <option value="status">Situação</option>
                <option value="nome">Nome</option>
              </select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={soAlerta} onChange={(e) => setSoAlerta(e.target.checked)} /> Só perto do limite ou esgotadas
              </label>
              <button onClick={exportar} className="px-3 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 text-sm sm:ml-auto">Exportar CSV</button>
            </div>

            <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="p-3">Empresa</th><th className="p-3">Plano</th><th className="p-3">Usadas / limite</th><th className="p-3">Tokens (entrada / saída)</th><th className="p-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((e) => {
                    const [rot, cls] = STATUS[e.status];
                    return (
                      <tr key={e.id} className="border-b border-gray-800/50">
                        <td className="p-3"><Link to={`/super/empresas/${e.id}`} className="text-blue-400 hover:text-blue-300">{e.nome}</Link></td>
                        <td className="p-3">{e.plano || "—"}</td>
                        <td className="p-3">
                          {e.limite == null ? `${fmt(e.respostas)} / ilimitado` : `${fmt(e.respostas)} / ${fmt(e.limite)} (${e.pct}%)`}
                          {e.limite != null && (
                            <div className="h-1.5 bg-gray-800 rounded mt-1 w-40 max-w-full">
                              <div className={`h-1.5 rounded ${e.status === "esgotado" ? "bg-red-500" : e.status === "perto" ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${e.pct}%` }} />
                            </div>
                          )}
                        </td>
                        <td className="p-3">{fmt(e.tokens_in)} / {fmt(e.tokens_out)}</td>
                        <td className="p-3"><span className={`px-2 py-1 rounded text-xs border ${cls}`}>{rot}</span></td>
                      </tr>
                    );
                  })}
                  {!linhas.length && <tr><td colSpan={5} className="p-6 text-center text-gray-500">Nenhuma empresa encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
        {carregando && !dados && !erro && <p className="text-gray-500">Carregando...</p>}
      </div>
    </div>
  );
}
