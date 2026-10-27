import React, { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { abrirJanelaImpressao, escreverCartoes } from "../../utils/imprimirVouchers";
import VouchersRelatorio from "../../components/admin/VouchersRelatorio";

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
  const [empresaId, setEmpresaId] = useState("");
  const [filtro, setFiltro] = useState({ status: "", lote: "", q: "", equipamento: "", impresso: "" });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const [modal, setModal] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [impressao, setImpressao] = useState(null); // { rede, qr, equipamento, eq, lote, quantidade, pular, marcados, imprimindo }
  const [sel, setSel] = useState([]); // ids marcados na lista (so da pagina atual)
  const [contagem, setContagem] = useState(null);
  const [exclFiltro, setExclFiltro] = useState(null); // { alvo, texto, rodando, apagados }
  const [aba, setAba] = useState("lista"); // lista | relatorio
  const [novo, setNovo] = useState({ plano_id: "", mikrotik_id: "", modo: "lote", quantidade: 10, codigo: "", lote: "", valido_ate: "" });
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
      const d = await chamar(`/api/vouchers?${qs}`);
      setDados(d);
      if (d.empresa_id) setEmpresaId(d.empresa_id);
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  }, [chamar, filtro, page]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { setSel([]); }, [filtro, page]);
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
      const body = { plano_id: novo.plano_id, mikrotik_id: novo.mikrotik_id, lote: novo.lote, valido_ate: novo.valido_ate || null };
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
      if (filtro.equipamento) qs.set("equipamento", filtro.equipamento);
      const res = await fetch(`/api/vouchers/export?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Erro ao exportar");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "vouchers.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  };

  // Contagem ao vivo do dialogo de impressao (sem marcados): quantos cartoes saem com estes filtros.
  const consultaImpressao = useCallback((i) => {
    const qs = new URLSearchParams({ page: 1, limit: 1, status: "disponivel" });
    if (i.lote) qs.set("lote", i.lote);
    if (i.eq) qs.set("equipamento", i.eq);
    if (i.pular) qs.set("impresso", "nao");
    if (filtro.q) qs.set("q", filtro.q);
    return qs;
  }, [filtro.q]);

  useEffect(() => {
    if (!impressao || impressao.marcados) { setContagem(null); return; }
    let vivo = true;
    chamar(`/api/vouchers?${consultaImpressao(impressao)}`)
      .then((d) => { if (vivo) setContagem(d.total); })
      .catch(() => { if (vivo) setContagem(null); });
    return () => { vivo = false; };
  }, [impressao?.lote, impressao?.eq, impressao?.pular, impressao?.marcados, consultaImpressao, chamar]); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirImpressao = () => setImpressao({
    rede: "", qr: true, equipamento: "", eq: filtro.equipamento, lote: filtro.lote, quantidade: "",
    pular: true, marcados: selDisp.length > 0, imprimindo: false,
  });

  // Imprime os marcados na lista OU os DISPONIVEIS dos filtros do dialogo (mais antigos primeiro, ate a quantidade).
  const imprimir = async (e) => {
    e.preventDefault();
    setMsg(null);
    const janela = abrirJanelaImpressao();
    if (!janela) { setMsg({ tipo: "erro", texto: "O navegador bloqueou a janela de impressão. Permita pop-ups para este site." }); return; }
    setImpressao((i) => ({ ...i, imprimindo: true }));
    try {
      let lista = [];
      let emp = empresaId;
      if (impressao.marcados) {
        lista = dados.data.filter((v) => sel.includes(v.id) && v.status === "disponivel");
      } else {
        const max = impressao.quantidade ? Math.max(1, Math.min(Number(impressao.quantidade) || 0, 5000)) : Infinity;
        for (let pg = 1; pg <= 25 && lista.length < max; pg++) {
          const qs = consultaImpressao(impressao);
          qs.set("page", pg); qs.set("limit", 200); qs.set("ordem", "asc");
          const d = await chamar(`/api/vouchers?${qs}`);
          lista = lista.concat(d.data || []);
          if (d.empresa_id) emp = d.empresa_id;
          if (lista.length >= d.total) break;
        }
        if (max !== Infinity) lista = lista.slice(0, max);
      }
      if (!lista.length) throw new Error("Não há vouchers para imprimir com esta seleção");
      const comQr = impressao.qr && emp;
      escreverCartoes(janela, lista, { rede: impressao.rede, ...(comQr ? { origem: window.location.origin, empresaId: emp, equipamentoPadrao: impressao.equipamento } : {}) });
      // Marca como impresso (nao bloqueia a impressao se falhar)
      chamar("/api/vouchers/impressos", { method: "POST", body: JSON.stringify({ ids: lista.map((v) => v.id).slice(0, 1000) }) })
        .then(() => carregar()).catch(() => {});
      setSel([]);
      setImpressao(null);
    } catch (err) {
      janela.close(); setMsg({ tipo: "erro", texto: err.message }); setImpressao((i) => (i ? { ...i, imprimindo: false } : i)); }
  };

  const selecionaveis = dados.data.filter((v) => v.status !== "usado"); // usados nunca saem do historico
  const selDisp = dados.data.filter((v) => sel.includes(v.id) && v.status === "disponivel");

  const acaoMassa = async (acao) => {
    const verbo = acao === "excluir" ? "Excluir" : "Cancelar";
    const aviso = acao === "excluir" ? " Isso não pode ser desfeito." : " Eles deixam de funcionar.";
    if (!window.confirm(`${verbo} ${sel.length} voucher(s) marcado(s)?${aviso} Vouchers já usados são ignorados.`)) return;
    try {
      const d = await chamar("/api/vouchers/massa", { method: "POST", body: JSON.stringify({ acao, ids: sel }) });
      setMsg({ tipo: "ok", texto: `${d.afetados} voucher(s) ${acao === "excluir" ? "excluído(s)" : "cancelado(s)"}${d.ignorados ? `, ${d.ignorados} ignorado(s)` : ""}` });
      setSel([]); carregar();
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); }
  };

  const abrirExclFiltro = async () => {
    setMsg(null);
    setExclFiltro({ alvo: null, texto: "", rodando: false, apagados: 0 });
    try {
      const d = await chamar("/api/vouchers/massa-filtro", { method: "POST", body: JSON.stringify({ filtros: filtro, previa: true }) });
      setExclFiltro((x) => x && { ...x, alvo: d.alvo });
    } catch (e) { setMsg({ tipo: "erro", texto: e.message }); setExclFiltro(null); }
  };

  const confirmarExclFiltro = async (e) => {
    e.preventDefault();
    setExclFiltro((x) => ({ ...x, rodando: true }));
    let total = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const d = await chamar("/api/vouchers/massa-filtro", { method: "POST", body: JSON.stringify({ filtros: filtro, confirmar: "EXCLUIR" }) });
        total += d.afetados;
        setExclFiltro((x) => x && { ...x, apagados: total });
        if (!d.restantes || !d.afetados) break;
      }
      setMsg({ tipo: "ok", texto: `${total} voucher(s) excluído(s)` });
    } catch (err) { setMsg({ tipo: "erro", texto: `${err.message}${total ? ` (${total} já excluídos)` : ""}` }); }
    finally { setExclFiltro(null); setSel([]); carregar(); }
  };

  const descricaoFiltro = () => {
    const partes = [];
    if (filtro.status) partes.push(`status ${STATUS[filtro.status]?.[0]?.toLowerCase()}`);
    if (filtro.equipamento) partes.push(`equipamento ${equipamentos[filtro.equipamento] || filtro.equipamento}`);
    if (filtro.lote) partes.push(filtro.lote === "__sem__" ? "sem lote" : `lote ${filtro.lote}`);
    if (filtro.impresso) partes.push(filtro.impresso === "sim" ? "já impressos" : "não impressos");
    if (filtro.q) partes.push(`código com “${filtro.q}”`);
    return partes.length ? partes.join(", ") : "todos os vouchers (disponíveis e cancelados)";
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
        <div className={`flex gap-2 flex-wrap ${aba === "lista" ? "" : "hidden"}`}>
          <button className={btnSecundario} onClick={exportar}>Exportar CSV</button>
          <button className={btnSecundario} onClick={abrirImpressao}>Imprimir cartões{selDisp.length > 0 ? ` (${selDisp.length})` : ""}</button>
          <button className={btnPrimario} onClick={() => setModal(true)}>Gerar vouchers</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b border-gray-800">
        {[["lista", "Lista"], ["relatorio", "Relatório de usados"]].map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 cursor-pointer ${aba === k ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>{t}</button>
        ))}
      </div>

      {aba === "relatorio" && <VouchersRelatorio chamar={chamar} token={token} equipamentos={equipamentos} lotes={dados.lotes} />}

      {msg && (
        <div className={`mb-4 p-3 rounded text-sm ${msg.tipo === "erro" ? "bg-red-900/30 text-red-300" : "bg-green-900/30 text-green-300"}`}>{msg.texto}</div>
      )}

      {aba === "lista" && (
      <>
      <div className="grid grid-cols-3 gap-3 mb-1">
        {Object.entries(STATUS).map(([k, [r, cls]]) => (
          <div key={k} className="bg-[#1a1d27] border border-gray-800 rounded p-3">
            <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{r}</span>
            <p className="text-2xl font-bold text-white mt-2">{c[k] || 0}</p>
            {k === "disponivel" && <p className="text-xs text-gray-500">{c.nao_impressos || 0} ainda não impressos</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input className={`${inputCls} !w-48`} placeholder="Buscar código" value={filtro.q} onChange={(e) => { setPage(1); setFiltro({ ...filtro, q: e.target.value }); }} />
        <select className={`${inputCls} !w-40`} value={filtro.status} onChange={(e) => { setPage(1); setFiltro({ ...filtro, status: e.target.value }); }}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, [r]]) => <option key={k} value={k}>{r}</option>)}
        </select>
        <select className={`${inputCls} !w-48`} value={filtro.equipamento} onChange={(e) => { setPage(1); setFiltro({ ...filtro, equipamento: e.target.value }); }}>
          <option value="">Todos os equipamentos</option>
          {Object.entries(equipamentos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
        <select className={`${inputCls} !w-44`} value={filtro.impresso} onChange={(e) => { setPage(1); setFiltro({ ...filtro, impresso: e.target.value }); }}>
          <option value="">Impressos e não</option>
          <option value="nao">Não impressos</option>
          <option value="sim">Já impressos</option>
        </select>
        <select className={`${inputCls} !w-40`} value={filtro.lote} onChange={(e) => { setPage(1); setFiltro({ ...filtro, lote: e.target.value }); }}>
          <option value="">Todos os lotes</option>
          {(dados.lotes || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 min-h-[2.25rem]">
        {sel.length > 0 ? (
          <>
            <span className="text-sm text-white">{sel.length} selecionado(s)</span>
            <button className={btnSecundario} onClick={() => acaoMassa("cancelar")}>Cancelar selecionados</button>
            <button className="border border-red-800 text-red-300 px-3 py-2 rounded text-sm hover:bg-red-900/30 cursor-pointer" onClick={() => acaoMassa("excluir")}>Excluir selecionados</button>
            <button className="text-sm text-gray-400 hover:text-gray-200 cursor-pointer" onClick={() => setSel([])}>Limpar</button>
          </>
        ) : <span className="text-xs text-gray-500">Marque vouchers na lista para cancelar, excluir ou imprimir. Vouchers usados não podem ser excluídos.</span>}
        <button className="ml-auto border border-red-800 text-red-300 px-3 py-2 rounded text-sm hover:bg-red-900/30 disabled:opacity-40 cursor-pointer"
          disabled={filtro.status === "usado"} onClick={abrirExclFiltro}>Excluir todos do filtro atual…</button>
      </div>

      <div className="bg-[#1a1d27] border border-gray-800 rounded">
        <table className="w-full text-sm text-gray-300">
          <thead className="text-xs text-gray-500 uppercase">
            <tr>
              <th className="p-3 w-8">
                <input type="checkbox" aria-label="Selecionar todos da página"
                  checked={selecionaveis.length > 0 && selecionaveis.every((v) => sel.includes(v.id))}
                  onChange={(e) => setSel(e.target.checked ? selecionaveis.map((v) => v.id) : [])} />
              </th>
              <th className="text-left p-3">Código</th><th className="text-left p-3">Plano</th><th className="text-left p-3">Lote</th>
              <th className="text-left p-3">Status</th><th className="text-left p-3">Válido até</th><th className="text-left p-3">Usado em</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {dados.data.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">Nenhum voucher encontrado.</td></tr>}
            {dados.data.map((v) => (
              <tr key={v.id} className="border-t border-gray-800">
                <td className="p-3">
                  {v.status !== "usado" && (
                    <input type="checkbox" aria-label={`Selecionar ${v.codigo}`} checked={sel.includes(v.id)}
                      onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} />
                  )}
                </td>
                <td className="p-3 font-mono tracking-wider text-white">
                  {v.codigo}
                  {v.impresso_em && <div className="text-xs text-gray-500 font-sans tracking-normal">impresso {fmt(v.impresso_em)}</div>}
                </td>
                <td className="p-3">
                  {v.plano_nome || "-"}
                  <div className="text-xs text-gray-500">{v.equipamento_nome || "Qualquer equipamento (legado)"}</div>
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

      </>
      )}

      {exclFiltro && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={confirmarExclFiltro} className="bg-[#1a1d27] border border-gray-700 rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="text-lg font-bold text-white">Excluir vouchers do filtro</h2>
            <p className="text-sm text-gray-400">Filtro atual: <b>{descricaoFiltro()}</b>. Vouchers já usados nunca são excluídos.</p>
            <p className="text-sm text-white">
              {exclFiltro.alvo === null ? "Contando..." : exclFiltro.alvo === 0 ? "Nenhum voucher para excluir com este filtro." : `${exclFiltro.alvo} voucher(s) serão excluídos. Isso não pode ser desfeito.`}
            </p>
            {exclFiltro.alvo > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Digite EXCLUIR para confirmar</label>
                <input className={inputCls} value={exclFiltro.texto} autoComplete="off" onChange={(e) => setExclFiltro({ ...exclFiltro, texto: e.target.value })} />
              </div>
            )}
            {exclFiltro.rodando && <p className="text-sm text-yellow-300">Excluindo... {exclFiltro.apagados} até agora</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className={btnSecundario} disabled={exclFiltro.rodando} onClick={() => setExclFiltro(null)}>Cancelar</button>
              <button type="submit" className="bg-red-700 text-white px-4 py-2 rounded text-sm hover:bg-red-600 disabled:opacity-50 cursor-pointer"
                disabled={exclFiltro.rodando || !exclFiltro.alvo || exclFiltro.texto !== "EXCLUIR"}>Excluir</button>
            </div>
          </form>
        </div>
      )}

      {impressao && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={imprimir} className="bg-[#1a1d27] border border-gray-700 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
            <h2 className="text-lg font-bold text-white">Imprimir cartões</h2>
            {impressao.marcados ? (
              <p className="text-sm text-gray-400">Serão impressos os <b>{selDisp.length}</b> voucher(s) disponíveis marcados na lista, 30 cartões por folha A4.</p>
            ) : (
              <>
                <p className="text-sm text-gray-400">Imprime vouchers <b>disponíveis</b> (os mais antigos primeiro), 30 cartões por folha A4.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Equipamento</label>
                    <select className={inputCls} value={impressao.eq} onChange={(e) => setImpressao({ ...impressao, eq: e.target.value })}>
                      <option value="">Todos</option>
                      {Object.entries(equipamentos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Lote</label>
                    <select className={inputCls} value={impressao.lote} onChange={(e) => setImpressao({ ...impressao, lote: e.target.value })}>
                      <option value="">Todos</option>
                      {(dados.lotes || []).map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Quantidade (vazio = todos)</label>
                  <input type="number" min="1" max="5000" className={inputCls} value={impressao.quantidade} onChange={(e) => setImpressao({ ...impressao, quantidade: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={impressao.pular} onChange={(e) => setImpressao({ ...impressao, pular: e.target.checked })} />
                  Pular os já impressos
                </label>
                <p className="text-sm text-white">
                  {contagem === null ? "Contando..." : `${impressao.quantidade ? Math.min(contagem, Number(impressao.quantidade) || contagem) : contagem} cartão(ões) serão impressos`}
                </p>
              </>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome da rede Wi-Fi (opcional, aparece no cartão)</label>
              <input className={inputCls} maxLength={40} value={impressao.rede} onChange={(e) => setImpressao({ ...impressao, rede: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={impressao.qr} onChange={(e) => setImpressao({ ...impressao, qr: e.target.checked })} />
              Incluir QR code que abre o portal com o código preenchido
            </label>
            {impressao.qr && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Equipamento do QR para vouchers antigos (sem equipamento)</label>
                <select className={inputCls} value={impressao.equipamento} onChange={(e) => setImpressao({ ...impressao, equipamento: e.target.value })}>
                  <option value="">Sem QR nesses cartões</option>
                  {Object.entries(equipamentos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className={btnSecundario} onClick={() => setImpressao(null)}>Cancelar</button>
              <button type="submit" className={btnPrimario} disabled={impressao.imprimindo || (!impressao.marcados && contagem === 0)}>{impressao.imprimindo ? "Preparando..." : "Imprimir"}</button>
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
                  <select required className={inputCls} value={novo.plano_id} onChange={(e) => {
                    const pl = planos.find((x) => String(x.id) === e.target.value);
                    setNovo({ ...novo, plano_id: e.target.value, mikrotik_id: pl?.mikrotik_id && equipamentos[pl.mikrotik_id] ? String(pl.mikrotik_id) : novo.mikrotik_id });
                  }}>
                    <option value="">Selecione...</option>
                    {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.duracao_minutos} min)</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Equipamento * (o voucher só vale nele)</label>
                  <select required className={inputCls} value={novo.mikrotik_id} onChange={(e) => setNovo({ ...novo, mikrotik_id: e.target.value })}>
                    <option value="">Selecione...</option>
                    {Object.entries(equipamentos).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
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
