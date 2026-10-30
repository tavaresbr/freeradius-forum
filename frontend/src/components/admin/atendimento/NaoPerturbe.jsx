import React, { useCallback, useEffect, useRef, useState } from "react";

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TIPOS = {
  promocao: "Promoções", renovacao: "Renovação", pos_compra: "Pós-compra",
  aviso_expiracao: "Aviso de tempo acabando", manutencao: "Manutenções",
};
const ORIGENS = { manual: "Manual", sair: "Respondeu SAIR", importado: "Importado" };

// Não perturbe: lista central de telefones sem mensagens proativas + horário de silêncio.
export default function NaoPerturbe({ headers }) {
  const [cfg, setCfg] = useState(null);
  const [lista, setLista] = useState({ itens: [], total: 0, resumo: {}, pronto: true });
  const [pagina, setPagina] = useState(1);
  const [q, setQ] = useState("");
  const [tel, setTel] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const arquivo = useRef(null);

  const carregarLista = useCallback(async () => {
    try {
      const r = await fetch(`/api/atendimento/nao-perturbe?pagina=${pagina}&q=${encodeURIComponent(q)}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setLista(d); else setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar a lista" });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, q]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/atendimento/nao-perturbe/config", { headers });
        const d = await r.json().catch(() => ({}));
        if (r.ok) setCfg(d.config);
      } catch { /* a lista mostra o erro */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const t = setTimeout(carregarLista, q ? 400 : 0); return () => clearTimeout(t); }, [carregarLista, q]);

  const chamar = async (url, metodo, corpo, ok) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível concluir" }); return null; }
      setMsg({ tipo: "ok", texto: typeof ok === "function" ? ok(d) : ok });
      return d;
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); return null; }
    finally { setBusy(false); }
  };

  const salvarCfg = async (e) => {
    e.preventDefault();
    const d = await chamar("/api/atendimento/nao-perturbe/config", "PUT", cfg, "Horário de silêncio salvo.");
    if (d?.config) setCfg(d.config);
  };
  const adicionar = async (e) => {
    e.preventDefault();
    const d = await chamar("/api/atendimento/nao-perturbe", "POST", { telefone: tel, motivo }, (x) => (x.adicionado ? "Telefone adicionado." : "Esse telefone já estava na lista."));
    if (d) { setTel(""); setMotivo(""); carregarLista(); }
  };
  const remover = async (i) => {
    if (!window.confirm(`Voltar a permitir mensagens para ${i.telefone_mascarado}?`)) return;
    if (await chamar(`/api/atendimento/nao-perturbe/${i.id}`, "DELETE", null, "Removido da lista.")) carregarLista();
  };
  const importar = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const texto = await f.text();
    const telefones = texto.split(/[\r\n;,]+/).map((s) => s.trim()).filter(Boolean);
    const d = await chamar("/api/atendimento/nao-perturbe/importar", "POST", { telefones },
      (x) => `${x.adicionados} adicionados, ${x.repetidos} já estavam na lista, ${x.invalidos} inválidos.`);
    if (d) carregarLista();
  };
  const exportar = async () => {
    try {
      const r = await fetch("/api/atendimento/nao-perturbe/export", { headers });
      if (!r.ok) { setMsg({ tipo: "erro", texto: "Não foi possível exportar" }); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "nao-perturbe.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
  };

  const alternar = (campo, valor) => setCfg((c) => {
    const atual = new Set(c[campo]);
    if (atual.has(valor)) atual.delete(valor); else atual.add(valor);
    return { ...c, [campo]: [...atual].sort() };
  });
  const paginas = Math.max(1, Math.ceil((lista.total || 0) / (lista.por_pagina || 50)));

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">Quem está nesta lista (ou pediu para sair no cadastro) <b>não recebe</b> promoções, lembretes nem avisos automáticos. Responder a uma mensagem do próprio cliente continua funcionando.</p>
      {msg && <p role="status" className={`text-sm ${msg.tipo === "erro" ? "text-red-400" : "text-green-400"}`}>{msg.texto}</p>}

      {cfg && (
        <form onSubmit={salvarCfg} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} />
            Respeitar horário de silêncio (não enviar mensagens automáticas à noite)
          </label>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <label className="text-xs text-gray-400">Início do silêncio
              <input type="time" className={inputCls} value={cfg.de} onChange={(e) => setCfg({ ...cfg, de: e.target.value })} required />
            </label>
            <label className="text-xs text-gray-400">Fim do silêncio
              <input type="time" className={inputCls} value={cfg.ate} onChange={(e) => setCfg({ ...cfg, ate: e.target.value })} required />
            </label>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Noites com silêncio (o dia em que ele começa)</p>
            <div className="flex gap-1 flex-wrap">
              {DIAS.map((n, d) => (
                <button type="button" key={d} aria-pressed={cfg.dias.includes(d)} onClick={() => alternar("dias", d)}
                  className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${cfg.dias.includes(d) ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300"}`}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Vale para</p>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(TIPOS).map(([id, nome]) => (
                <label key={id} className="flex items-center gap-1 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={cfg.aplicar_a.includes(id)} onChange={() => alternar("aplicar_a", id)} /> {nome}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">Fora do horário os envios apenas esperam: nada é perdido nem marcado como enviado. Avisos operacionais e alertas de queda não entram no silêncio.</p>
          </div>
          <button className={btnPrimario} disabled={busy}>Salvar horário</button>
        </form>
      )}

      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-4 text-sm text-gray-300">
          <span><b>{lista.total || 0}</b> na lista</span>
          {Object.entries(ORIGENS).map(([k, n]) => (lista.resumo?.[k] ? <span key={k}>{n}: <b>{lista.resumo[k]}</b></span> : null))}
          <span>Clientes que pediram para sair: <b>{lista.resumo?.clientes_optout || 0}</b></span>
        </div>
        {lista.pronto === false && <p className="text-sm text-yellow-300">{lista.aviso || "Rode a migration 063 no servidor."}</p>}
        <form onSubmit={adicionar} className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-gray-400 flex-1 min-w-[180px]">Telefone (com DDD)
            <input className={inputCls} value={tel} onChange={(e) => setTel(e.target.value)} placeholder="(93) 98888-7777" required />
          </label>
          <label className="text-xs text-gray-400 flex-1 min-w-[180px]">Motivo (opcional)
            <input className={inputCls} value={motivo} maxLength={120} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <button className={btnPrimario} disabled={busy || lista.pronto === false}>Adicionar</button>
        </form>
        <div className="flex flex-wrap gap-2">
          <input ref={arquivo} type="file" accept=".csv,.txt" className="hidden" onChange={importar} />
          <button type="button" className={btnSecundario} disabled={busy || lista.pronto === false} onClick={() => arquivo.current?.click()}>Importar lista (CSV/TXT, até 5000)</button>
          <button type="button" className={btnSecundario} onClick={exportar}>Exportar CSV</button>
          <input className={`${inputCls} max-w-[220px]`} placeholder="Buscar telefone" value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} />
        </div>
        {lista.itens.length === 0 ? <p className="text-sm text-gray-500">Nenhum telefone na lista.</p> : (
          <table className="w-full text-sm text-gray-300">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Telefone</th><th>Origem</th><th>Motivo</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {lista.itens.map((i) => (
                <tr key={i.id} className="border-t border-gray-800">
                  <td className="py-2">{i.telefone_mascarado}</td>
                  <td>{ORIGENS[i.origem] || i.origem}</td>
                  <td>{i.motivo || "-"}</td>
                  <td>{i.criado_em ? new Date(i.criado_em).toLocaleDateString("pt-BR") : "-"}</td>
                  <td className="text-right"><button className="text-red-400 hover:text-red-300 text-xs cursor-pointer" onClick={() => remover(i)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginas > 1 && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <button className={btnSecundario} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <span>{pagina} / {paginas}</span>
            <button className={btnSecundario} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Próxima</button>
          </div>
        )}
      </div>
    </div>
  );
}
