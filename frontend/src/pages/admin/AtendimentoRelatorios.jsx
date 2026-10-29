import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Moldura from "../../components/admin/Moldura";

const hojeStr = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const dur = (s) => {
  if (s == null) return "—";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};
// Evita que uma celula do CSV vire formula no Excel
const celula = (v) => {
  const t = String(v ?? "");
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
};

function Card({ titulo, valor, detalhe }) {
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className="text-2xl font-bold text-white mt-1">{valor}</p>
      {detalhe && <p className="text-xs text-gray-500 mt-1">{detalhe}</p>}
    </div>
  );
}

export default function AtendimentoRelatorios({ embutido = false }) {
  const { empresaSlug } = useParams();
  const [de, setDe] = useState(diasAtras(29));
  const [ate, setAte] = useState(hojeStr());
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const token = localStorage.getItem("admin_token");

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const res = await fetch(`/api/atendimento/relatorios?de=${de}&ate=${ate}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.error || "Não foi possível carregar o relatório"); setDados(null); return; }
      setDados(d);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setCarregando(false);
    }
  }, [de, ate, token]);
  useEffect(() => { carregar(); }, [carregar]);

  const baixarCsv = () => {
    if (!dados) return;
    const linhas = [["Dia", "Recebidas", "Enviadas"], ...dados.por_dia.map((d) => [d.dia, d.recebidas, d.enviadas]), [], ["Atendente", "Mensagens enviadas"], ...dados.por_atendente.map((a) => [a.nome, a.enviadas])];
    const csv = linhas.map((l) => l.map((c) => `"${celula(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `atendimento-${de}-a-${ate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const maxDia = dados ? Math.max(1, ...dados.por_dia.map((d) => Math.max(d.recebidas, d.enviadas))) : 1;
  const inputCls = "px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 text-sm min-w-0";

  return (
    <Moldura embutido={embutido}>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold text-white">Relatórios do atendimento</h1>
          <Link to={`/admin/${empresaSlug}/atendimento`} className="text-sm text-blue-400 hover:text-blue-300">← Voltar ao WhatsApp</Link>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">De<input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={`${inputCls} block mt-1`} /></label>
          <label className="text-xs text-gray-500">Até<input type="date" value={ate} min={de} max={hojeStr()} onChange={(e) => setAte(e.target.value)} className={`${inputCls} block mt-1`} /></label>
          <button onClick={baixarCsv} disabled={!dados} className="px-3 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] text-sm cursor-pointer disabled:opacity-50">Baixar CSV</button>
        </div>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        {carregando && !dados && <p className="text-sm text-gray-500">Carregando…</p>}
        {dados && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card titulo="Conversas novas" valor={dados.conversas.novas} detalhe={`${dados.conversas.abertas} abertas · ${dados.conversas.resolvidas} resolvidas`} />
              <Card titulo="1ª resposta (média)" valor={dur(dados.primeira_resposta.media_seg)} detalhe={`${dados.primeira_resposta.conversas} conversas respondidas`} />
              <Card titulo="1ª resposta (mediana)" valor={dur(dados.primeira_resposta.mediana_seg)} detalhe="Respostas automáticas não contam" />
              <Card titulo="Satisfação" valor={dados.satisfacao.media != null ? `${dados.satisfacao.media} / 5` : "—"} detalhe={`${dados.satisfacao.respostas} notas`} />
            </div>

            <section className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Mensagens por dia</h2>
              {dados.por_dia.length === 0 ? <p className="text-sm text-gray-500">Sem mensagens no período.</p> : (
                <div className="space-y-1">
                  {dados.por_dia.map((d) => (
                    <div key={d.dia} className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="w-20 shrink-0 text-gray-500">{d.dia.split("-").reverse().slice(0, 2).join("/")}</span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="h-2 bg-blue-500 rounded" style={{ width: `${(d.recebidas / maxDia) * 100}%` }} title={`${d.recebidas} recebidas`} />
                        <div className="h-2 bg-green-500 rounded" style={{ width: `${(d.enviadas / maxDia) * 100}%` }} title={`${d.enviadas} enviadas`} />
                      </div>
                      <span className="w-16 shrink-0 text-right">{d.recebidas}/{d.enviadas}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-500 pt-1"><span className="inline-block w-2 h-2 bg-blue-500 rounded mr-1" />recebidas <span className="inline-block w-2 h-2 bg-green-500 rounded mx-1 ml-3" />enviadas</p>
                </div>
              )}
            </section>

            <div className="grid lg:grid-cols-2 gap-3">
              <section className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-3">Mensagens por atendente</h2>
                {dados.por_atendente.length === 0 ? <p className="text-sm text-gray-500">Nenhuma mensagem enviada por atendente.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1">Atendente</th><th className="pb-1 text-right">Enviadas</th></tr></thead>
                    <tbody>{dados.por_atendente.map((a) => <tr key={a.nome} className="text-gray-200"><td className="py-1">{a.nome}</td><td className="py-1 text-right">{a.enviadas}</td></tr>)}</tbody>
                  </table>
                )}
              </section>
              <section className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-white mb-3">Notas de satisfação</h2>
                {dados.satisfacao.respostas === 0 ? <p className="text-sm text-gray-500">Nenhuma nota no período. Ative a pesquisa em "Resposta automática".</p> : (
                  <div className="space-y-1">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <div key={n} className="flex items-center gap-2 text-xs text-gray-300">
                        <span className="w-6">{n}★</span>
                        <div className="flex-1 min-w-0 h-2 bg-gray-800 rounded"><div className="h-2 bg-yellow-500 rounded" style={{ width: `${(dados.satisfacao.distribuicao[n] / dados.satisfacao.respostas) * 100}%` }} /></div>
                        <span className="w-8 text-right">{dados.satisfacao.distribuicao[n]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </Moldura>
  );
}
