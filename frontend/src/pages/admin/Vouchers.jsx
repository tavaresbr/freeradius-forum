import React, { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { abrirJanelaImpressao, escreverCartoes } from "../../utils/imprimirVouchers";

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const STATUS = {
  disponivel: ["Disponível", "bg-green-900/40 text-green-300"],
  usado: ["Usado", "bg-blue-900/40 text-blue-300"],
  cancelado: ["Cancelado", "bg-red-900/40 text-red-300"],
};
const fmt = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "-");
const fmtDia = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "-");

export default function Vouchers() {
  const token = localStorage.getItem("admin_token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const [dados, setDados] = useState({ data: [], total: 0, contadores: {}, lotes: [] });
  const [planos, setPlanos] = useState([]);
  const [equipamentos, setEquipamentos] = useState({});
  const [filtro, setFiltro] = useState({ status: "", lote: "", q: "" });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const [modal, setModal] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [impressao, setImpressao] = useState(null); // { rede, imprimindo }
  const [novo, setNovo] = useState({ plano_id: "", modo: "lote", quantidade: 10, codigo: "", lote: "", valido_ate: "" });
  const [gerados, setGerados] = useState(null);

  const chamar = useCallback(async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro na requisição");
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const carregar = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page, limit: 50 });
      Object.entries(filtro).forEach(([k, v]) => v && qs.set(k, v));
      setDados(await chamar(`/api/vouchers?${qs}`));
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  }, [chamar, filtro, page]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    chamar("/api/planos").then((d) => setPlanos(Array.isArray(d) ? d : d.data || [])).catch(() => {});
    chamar("/api/mikrotiks").then((d) => {
      const lista = Array.isArray(d) ? d : d.data || [];
      setEquipamentos(Object.fromEntries(lista.map((m) => [m.id, m.nome])));
    }).catch(() => {});
  }, [chamar]);

  const gerar = async (e) => {
    e.preventDefault();
    setOcupado(true); setMsg(null);
    try {
      const body = { plano_id: novo.plano_id, lote: novo.lote, valido_ate: novo.valido_ate || null };
      if (novo.modo === "lote") body.quantidade = Number(novo.quantidade); else body.codigo = novo.codigo;
      const d = await chamar("/api/vouchers", { method: "POST", body: JSON.stringify(body) });
      setGerados(d.codigos);
      setMsg({ tipo: "ok", texto: `${d.criados} voucher(s) criado(s)` });
      setPage(1); carregar();
    } catch (err) { setMsg({ tipo: "erro", texto: err.message }); }
    finally { setOcupado(false); }
  };

  const acao = async (id, tipo) => {
    if (tipo === "excluir" && !window.confirm("Excluir este voucher?")) return;
    if (tipo === "cancelar" && !window.confirm("Cancelar este voucher? Ele deixará de funcionar.")) return;
    try {
      await chamar(tipo === "excluir" ? `/api/vouchers/${id}` : `/api/vouchers/${id}/cancelar`, { method: tipo === "excluir" ? "DELETE" : "POST" });
      carregar();
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  };

  const exportar = async () => {
    try {
      const qs = new URLSearchParams();
      if (filtro.lote) qs.set("lote", filtro.lote);
      if (filtro.status) qs.set("status", filtro.status);
      const res = await fetch(`/api/vouchers/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Erro ao exportar");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "vouchers.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  };

  // Imprime so os vouchers DISPONIVEIS do filtro atual (lote/busca), todas as paginas.
  const imprimir = async (e) => {
    e.preventDefault();
    setMsg(null);
    const janela = abrirJanelaImpressao();
    if (!janela) { setMsg({ tipo: "erro", texto: "O navegador bloqueou a janela de impressão. Permita pop-ups para este site." }); return; }
    setImpressao((i) => ({ ...i, imprimindo: true }));
    try {
      let todos = [];
      for (let pg = 1; pg <= 10; pg++) {
        const qs = new URLSearchParams({ page: pg, limit: 200, status: "disponivel" });
        if (filtro.lote) qs.set("lote", filtro.lote);
        if (filtro.q) qs.set("q", filtro.q);
        const d = await chamar(`/api/vouchers?${qs}`);
        todos = todos.concat(d.data || []);
        if (todos.length >= d.total) break;
      }
      if (!todos.length) throw new Error("Não há vouchers disponíveis neste filtro para imprimir");
      escreverCartoes(janela, todos, { rede: impressao.rede });
      setImpressao(null);
    } catch (err) {
      janela.close(); setMsg({ tipo: "erro", texto: err.message }); setImpressao((i) => (i ? { ...i, imprimindo: false } : i)); }
  };

  const fecharModal = () => { setModal(false); setGerados(null); };
  const c = dados.contadores || {};
  const paginas = Math.max(1, Math.ceil((dados.total || 0) / 50));

  return (
    <AdminLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Vouchers</h1>
          <p className="text-sm text-gray-400">Códigos de acesso Wi-Fi para o portal “Acesso por Voucher”.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className={btnSecundario} onClick={exportar}>Exportar CSV</button>
          <button className={btnSecundario} onClick={() => setImpressao({ rede: "", imprimindo: false })}>Imprimir cartões</button>
          <button className={btnPrimario} onClick={() => setModal(true)}>Gerar vouchers</button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded text-sm ${msg.tipo === "erro" ? "bg-red-900/30 text-red-300" : "bg-green-900/30 text-green-300"}`}>{msg.texto}</div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        {Object.entries(STATUS).map(([k, [r, cls]]) => (
          <div key={k} className="bg-[#1a1d27] border border-gray-800 rounded p-3">
            <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{r}</span>
            <p className="text-2xl font-bold text-white mt-2">{c[k] || 0}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input className={`${inputCls} !w-48`} placeholder="Buscar código" value={filtro.q} onChange={(e) => { setPage(1); setFiltro({ ...filtro, q: e.target.value }); }} />
        <select className={`${inputCls} !w-40`} value={filtro.status} onChange={(e) => { setPage(1); setFiltro({ ...filtro, status: e.target.value }); }}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, [r]]) => <option key={k} value={k}>{r}</option>)}
        </select>
        <select className={`${inputCls} !w-40`} value={filtro.lote} onChange={(e) => { setPage(1); setFiltro({ ...filtro, lote: e.target.value }); }}>
          <option value="">Todos os lotes</option>
          {(dados.lotes || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="bg-[#1a1d27] border border-gray-800 rounded">
        <table className="w-full text-sm text-gray-300">
          <thead className="text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left p-3">Código</th><th className="text-left p-3">Plano</th><th className="text-left p-3">Lote</th>
              <th className="text-left p-3">Status</th><th className="text-left p-3">Válido até</th><th className="text-left p-3">Usado em</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {dados.data.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-500">Nenhum voucher encontrado.</td></tr>}
            {dados.data.map((v) => (
              <tr key={v.id} className="border-t border-gray-800">
                <td className="p-3 font-mono tracking-wider text-white">{v.codigo}</td>
                <td className="p-3">
                  {v.plano_nome || "-"}
                  <div className="text-xs text-gray-500">{v.equipamento_nome || "Qualquer equipamento"}</div>
                </td>
                <td className="p-3">{v.lote || "-"}</td>
                <td className="p-3"><span className={`text-xs px-2 py-1 rounded-full ${STATUS[v.status]?.[1]}`}>{STATUS[v.status]?.[0]}</span></td>
                <td className="p-3">{fmtDia(v.valido_ate)}</td>
                <td className="p-3">
                  {fmt(v.usado_em)}
                  {v.usado_equipamento && <div className="text-xs text-gray-500">{v.usado_equipamento}</div>}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {v.status === "disponivel" && <button className="text-yellow-400 hover:underline mr-3" onClick={() => acao(v.id, "cancelar")}>Cancelar</button>}
                  {v.status !== "usado" && <button className="text-red-400 hover:underline" onClick={() => acao(v.id, "excluir")}>Excluir</button>}
                </td>
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

      {impressao && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={imprimir} className="bg-[#1a1d27] border border-gray-700 rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="text-lg font-bold text-white">Imprimir cartões</h2>
            <p className="text-sm text-gray-400">
              Imprime os vouchers <b>disponíveis</b>{filtro.lote ? <> do lote <b>{filtro.lote}</b></> : " (todos os lotes)"}{filtro.q ? <>, com a busca “{filtro.q}”</> : ""}, 8 cartões por folha A4.
            </p>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome da rede Wi-Fi (opcional, aparece no cartão)</label>
              <input className={inputCls} maxLength={40} value={impressao.rede} onChange={(e) => setImpressao({ ...impressao, rede: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className={btnSecundario} onClick={() => setImpressao(null)}>Cancelar</button>
              <button type="submit" className={btnPrimario} disabled={impressao.imprimindo}>{impressao.imprimindo ? "Preparando..." : "Imprimir"}</button>
            </div>
          </form>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d27] border border-gray-700 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">Gerar vouchers</h2>
            {gerados ? (
              <div>
                <p className="text-sm text-green-300 mb-2">{gerados.length} código(s) criado(s):</p>
                <textarea readOnly className={`${inputCls} font-mono h-40`} value={gerados.join("\n")} />
                <div className="flex gap-2 justify-end mt-4">
                  <button className={btnSecundario} onClick={() => navigator.clipboard?.writeText(gerados.join("\n"))}>Copiar códigos</button>
                  <button className={btnPrimario} onClick={fecharModal}>Fechar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={gerar} className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Plano *</label>
                  <select required className={inputCls} value={novo.plano_id} onChange={(e) => setNovo({ ...novo, plano_id: e.target.value })}>
                    <option value="">Selecione...</option>
                    {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} — {equipamentos[p.mikrotik_id] || "Qualquer equipamento"} ({p.duracao_minutos} min)</option>)}
                  </select>
                </div>
                <div className="flex gap-4 text-sm text-gray-300">
                  <label><input type="radio" checked={novo.modo === "lote"} onChange={() => setNovo({ ...novo, modo: "lote" })} /> Gerar em lote</label>
                  <label><input type="radio" checked={novo.modo === "um"} onChange={() => setNovo({ ...novo, modo: "um" })} /> Código personalizado</label>
                </div>
                {novo.modo === "lote" ? (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quantidade (1 a 500)</label>
                    <input type="number" min="1" max="500" required className={inputCls} value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Código (4 a 32 letras/números)</label>
                    <input required className={inputCls} value={novo.codigo} maxLength={32} onChange={(e) => setNovo({ ...novo, codigo: e.target.value.toUpperCase() })} />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Nome do lote (opcional)</label>
                  <input className={inputCls} maxLength={60} value={novo.lote} onChange={(e) => setNovo({ ...novo, lote: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Válido até (opcional)</label>
                  <input type="date" min={new Date().toISOString().slice(0, 10)} max="2099-12-31" className={inputCls} value={novo.valido_ate} onChange={(e) => setNovo({ ...novo, valido_ate: e.target.value })} />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" className={btnSecundario} onClick={fecharModal}>Cancelar</button>
                  <button type="submit" className={btnPrimario} disabled={ocupado}>{ocupado ? "Gerando..." : "Gerar"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
