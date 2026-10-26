import React, { useEffect, useState } from "react";

const PERIODOS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dataBr = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const num = (n) => Number(n || 0).toLocaleString("pt-BR");

function Cartao({ rotulo, valor, detalhe }) {
  return (
    <div className="bg-[#0d1117] border border-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{rotulo}</p>
      <p className="text-2xl font-bold text-white">{valor}</p>
      {detalhe && <p className="text-[11px] text-gray-500 mt-1">{detalhe}</p>}
    </div>
  );
}

// Resultados da campanha: visualizacoes e cliques (total, por dia e por item)
export default function CampanhaResultados({ campanhaId, token }) {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (dias - 1));
    setCarregando(true);
    setErro("");
    fetch(`/api/campanhas/${campanhaId}/metricas?de=${iso(inicio)}&ate=${iso(hoje)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const corpo = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(corpo.error || "Erro ao carregar resultados");
        if (!cancelado) setDados(corpo.data);
      })
      .catch((e) => { if (!cancelado) setErro(e.message); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [campanhaId, dias, token]);

  const maior = dados ? Math.max(1, ...dados.por_dia.map((d) => d.views)) : 1;

  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Resultados</h2>
        <div className="flex gap-1" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={`px-3 py-1 rounded text-xs border ${
                dias === p.dias ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && <p className="text-red-400 text-sm">{erro}</p>}
      {carregando && !dados && <p className="text-gray-400 text-sm">Carregando...</p>}

      {dados && (
        <div className={carregando ? "opacity-60" : ""}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Cartao rotulo="Visualizações" valor={num(dados.resumo.views)} detalhe="Pessoas que abriram a campanha (1 por visita)" />
            <Cartao rotulo={'Cliques em "Saiba mais"'} valor={num(dados.resumo.cliques)} />
            <Cartao rotulo="Taxa de clique" valor={`${String(dados.resumo.ctr).replace(".", ",")}%`} detalhe="Cliques ÷ visualizações" />
          </div>

          <h3 className="text-sm font-semibold text-gray-300 mb-2">Visualizações por dia</h3>
          {dados.por_dia.length === 0 ? (
            <p className="text-gray-500 text-sm mb-6">Ainda não há visualizações neste período.</p>
          ) : (
            <div className="flex items-end gap-1 h-32 mb-1 overflow-x-auto" aria-label="Gráfico de visualizações por dia">
              {dados.por_dia.map((d) => (
                <div key={d.dia} className="flex flex-col items-center justify-end h-full min-w-[18px] flex-1" title={`${dataBr(d.dia)}: ${d.views} visualizações, ${d.cliques} cliques`}>
                  <div className="w-full bg-blue-500/80 rounded-t" style={{ height: `${Math.max(4, (d.views / maior) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
          {dados.por_dia.length > 0 && (
            <div className="flex justify-between text-[10px] text-gray-500 mb-6">
              <span>{dataBr(dados.por_dia[0].dia)}</span>
              <span>{dataBr(dados.por_dia[dados.por_dia.length - 1].dia)}</span>
            </div>
          )}

          <h3 className="text-sm font-semibold text-gray-300 mb-2">Por item</h3>
          {dados.por_item.length === 0 ? (
            <p className="text-gray-500 text-sm">Sem itens.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500 border-b border-gray-800">
                <tr>
                  <th className="p-2">Item</th>
                  <th className="p-2 text-right">Visualizações</th>
                  <th className="p-2 text-right">Cliques</th>
                  <th className="p-2 text-right">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {dados.por_item.map((i, idx) => (
                  <tr key={i.item_id} className="border-b border-gray-800">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {i.arquivo_url && i.tipo === "imagem" && (
                          <img src={i.arquivo_url} alt="" className="w-10 h-10 object-cover rounded" />
                        )}
                        {i.arquivo_url && i.tipo === "video" && (
                          <video src={i.arquivo_url} className="w-10 h-10 object-cover rounded" muted preload="metadata" />
                        )}
                        <span className="text-gray-200 truncate max-w-[16rem]">
                          {i.removido ? "Item removido" : i.titulo || `Item ${idx + 1}`}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 text-right text-gray-300">{num(i.views)}</td>
                    <td className="p-2 text-right text-gray-300">{num(i.cliques)}</td>
                    <td className="p-2 text-right text-gray-300">{String(i.ctr).replace(".", ",")}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-gray-500 text-[11px] mt-4">
            Cada visita conta uma vez a cada 30 minutos. A pré-visualização do painel não entra na contagem.
            Os números começam a valer a partir desta atualização.
          </p>
        </div>
      )}
    </div>
  );
}
