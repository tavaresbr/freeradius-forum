import React, { useState, useEffect, useCallback } from "react";
import { htmlRelatorio, fmtDia, fmtDataHora, fmtDuracao } from "../../utils/relatorioVouchers";

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";

const iso = (d) => d.toISOString().slice(0, 10);
const periodoPadrao = () => { const f = new Date(); const i = new Date(f.getTime() - 29 * 86400000); return { de: iso(i), ate: iso(f) }; };

export default function VouchersRelatorio({ chamar, token, equipamentos, lotes }) {
  const [filtro, setFiltro] = useState({ ...periodoPadrao(), equipamento: "", lote: "" });
  const [page, setPage] = useState(1);
  const [rel, setRel] = useState(null);
  const [erro, setErro] = useState(null);
  const [imprimindo, setImprimindo] = useState(false);

  const consulta = useCallback((extra = {}) => {
    const qs = new URLSearchParams({ de: filtro.de, ate: filtro.ate });
    if (filtro.equipamento) qs.set("equipamento", filtro.equipamento);
    if (filtro.lote) qs.set("lote", filtro.lote);
    Object.entries(extra).forEach(([k, v]) => qs.set(k, v));
    return qs;
  }, [filtro]);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setRel(await chamar(`/api/vouchers/relatorio?${consulta({ page, limit: 50 })}`)); }
    catch (e) { setErro(e.message); setRel(null); }
  }, [chamar, consulta, page]);

  useEffect(() => { carregar(); }, [carregar]);

  const mudar = (campo) => (e) => { setPage(1); setFiltro({ ...filtro, [campo]: e.target.value }); };

  const exportar = async () => {
    try {
      const res = await fetch(`/api/vouchers/relatorio/export?${consulta()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erro ao exportar");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `vouchers-usados-${filtro.de}-a-${filtro.ate}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErro(e.message); }
  };

  // Janela aberta no clique (antes do fetch) para nao ser bloqueada como pop-up.
  const imprimir = async () => {
    const janela = window.open("", "_blank");
    if (!janela) { setErro("O navegador bloqueou a janela de impressão. Permita pop-ups para este site."); return; }
    setImprimindo(true); setErro(null);
    try {
      let linhas = [];
      let base = rel;
      for (let pg = 1; pg <= 25; pg++) {
        const d = await chamar(`/api/vouchers/relatorio?${consulta({ page: pg, limit: 200 })}`);
        base = d;
        linhas = linhas.concat(d.data || []);
        if (linhas.length >= d.total) break;
      }
      janela.document.open();
      janela.document.write(htmlRelatorio({ rel: base, linhas, filtros: { ...filtro, equipamentoNome: filtro.equipamento ? equipamentos[filtro.equipamento] : "" } }));
      janela.document.close();
    } catch (e) { janela.close(); setErro(e.message); }
    finally { setImprimindo(false); }
  };

  const r = rel?.resumo;
  const maxDia = Math.max(1, ...(rel?.por_dia || []).map((d) => d.n));
  const paginas = Math.max(1, Math.ceil((rel?.total || 0) / 50));
  const th = "text-left p-3";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div><label className="block text-xs text-gray-400 mb-1">De</label><input type="date" max={filtro.ate} className={`${inputCls} !w-40`} value={filtro.de} onChange={mudar("de")} /></div>
        <div><label className="block text-xs text-gray-400 mb-1">Até</label><input type="date" min={filtro.de} className={`${inputCls} !w-40`} value={filtro.ate} onChange={mudar("ate")} /></div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Equipamento</label>
          <select className={`${inputCls} !w-48`} value={filtro.equipamento} onChange={mudar("equipamento")}>
            <option value="">Todos</option>
            {Object.entries(equipamentos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Lote</label>
          <select className={`${inputCls} !w-40`} value={filtro.lote} onChange={mudar("lote")}>
            <option value="">Todos</option>
            <option value="__sem__">Sem lote</option>
            {(lotes || []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex gap-2 ml-auto">
          <button className={btnSecundario} onClick={exportar} disabled={!rel}>Exportar CSV</button>
          <button className={btnSecundario} onClick={imprimir} disabled={!rel || imprimindo}>{imprimindo ? "Preparando..." : "Imprimir relatório"}</button>
        </div>
      </div>

      {erro && <div className="mb-4 p-3 rounded text-sm bg-red-900/30 text-red-300">{erro}</div>}

      {r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[["Usados no período", r.usados_periodo], ["Disponíveis", r.disponiveis], ["Cancelados", r.cancelados], ["Taxa de uso", `${r.taxa_uso}%`]].map(([t, v]) => (
              <div key={t} className="bg-[#1a1d27] border border-gray-800 rounded p-3">
                <p className="text-xs text-gray-400">{t}</p>
                <p className="text-2xl font-bold text-white mt-1">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="bg-[#1a1d27] border border-gray-800 rounded p-3">
              <h3 className="text-sm font-semibold text-white mb-2">Usados por dia</h3>
              {rel.por_dia.length === 0 ? <p className="text-sm text-gray-500">Nenhum voucher usado no período.</p> : (
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {rel.por_dia.map((d) => (
                    <li key={d.dia} className="flex items-center gap-2 text-sm text-gray-300">
                      <span className="w-24 shrink-0">{fmtDia(d.dia)}</span>
                      <span className="flex-1 bg-gray-800 rounded h-3 overflow-hidden"><span className="block h-3 bg-blue-600" style={{ width: `${(d.n / maxDia) * 100}%` }} /></span>
                      <span className="w-8 text-right">{d.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-4">
              {[["Por equipamento", rel.por_equipamento, (e) => e.equipamento_nome || "Qualquer (legado)", (e) => e.equipamento_id ?? "x"],
                ["Por lote", rel.por_lote, (l) => l.lote || "Sem lote", (l) => l.lote ?? "x"]].map(([titulo, linhas, nome, chave]) => (
                <div key={titulo} className="bg-[#1a1d27] border border-gray-800 rounded p-3 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-white mb-2">{titulo}</h3>
                  <table className="w-full text-sm text-gray-300">
                    <thead className="text-xs text-gray-500"><tr><th className="text-left py-1">Nome</th><th className="text-right">Usados</th><th className="text-right">Disp.</th><th className="text-right">Canc.</th></tr></thead>
                    <tbody>
                      {linhas.length === 0 && <tr><td colSpan={4} className="py-2 text-gray-500">Sem dados.</td></tr>}
                      {linhas.map((l) => <tr key={chave(l)} className="border-t border-gray-800"><td className="py-1">{nome(l)}</td><td className="text-right">{l.usados_periodo}</td><td className="text-right">{l.disponiveis}</td><td className="text-right">{l.cancelados}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#1a1d27] border border-gray-800 rounded">
            <table className="w-full text-sm text-gray-300">
              <thead className="text-xs text-gray-500 uppercase">
                <tr><th className={th}>Código</th><th className={th}>Plano</th><th className={th}>Lote</th><th className={th}>Usado em</th><th className={th}>Aparelho</th><th className={th}>Consumido / plano</th></tr>
              </thead>
              <tbody>
                {rel.data.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nenhum voucher usado neste período.</td></tr>}
                {rel.data.map((v) => (
                  <tr key={v.id} className="border-t border-gray-800">
                    <td className="p-3 font-mono tracking-wider text-white">{v.codigo}</td>
                    <td className="p-3">{v.plano_nome || "-"}<div className="text-xs text-gray-500">{v.equipamento_nome || "Qualquer equipamento (legado)"}</div></td>
                    <td className="p-3">{v.lote || "-"}</td>
                    <td className="p-3">{fmtDataHora(v.usado_em)}{v.usado_equipamento && <div className="text-xs text-gray-500">{v.usado_equipamento}</div>}</td>
                    <td className="p-3 font-mono text-xs">{v.usado_mac || "-"}{v.usado_ip && <div className="text-gray-500">{v.usado_ip}</div>}</td>
                    <td className="p-3">{fmtDuracao(v.consumido_segundos)} / {fmtDuracao(v.total_segundos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paginas > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4 text-sm text-gray-400">
              <button className={btnSecundario} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <span>{page} / {paginas}</span>
              <button className={btnSecundario} disabled={page >= paginas} onClick={() => setPage(page + 1)}>Próxima</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
