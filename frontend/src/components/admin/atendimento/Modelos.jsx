import React, { useCallback, useEffect, useState } from "react";

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const VAZIO = { id: null, atalho: "", titulo: "", categoria: "geral", texto: "" };
const VARIAVEIS = ["{{nome}}", "{{empresa}}", "{{plano}}", "{{link}}", "{{minutos}}"];

// Modelos de mensagem (antigas "respostas rapidas"): categorias, atalho "/" nas conversas e "Usar modelo" nas outras abas.
export default function Modelos({ headers }) {
  const [lista, setLista] = useState([]);
  const [categorias, setCategorias] = useState({ geral: "Geral" });
  const [temCategoria, setTemCategoria] = useState(true);
  const [form, setForm] = useState(VAZIO);
  const [filtro, setFiltro] = useState("todas");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/atendimento/respostas-rapidas", { headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar" }); return; }
      setLista(d.respostas || []); setCategorias(d.categorias || { geral: "Geral" }); setTemCategoria(d.categoria_disponivel !== false);
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const chamar = async (url, metodo, corpo, ok) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível concluir" }); return false; }
      if (ok) setMsg({ tipo: "ok", texto: typeof ok === "function" ? ok(d) : ok });
      await carregar();
      return true;
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); return false; }
    finally { setBusy(false); }
  };

  const salvar = async (e) => {
    e.preventDefault();
    const url = form.id ? `/api/atendimento/respostas-rapidas/${form.id}` : "/api/atendimento/respostas-rapidas";
    if (await chamar(url, form.id ? "PUT" : "POST", form, "Modelo salvo.")) setForm(VAZIO);
  };
  const excluir = async (m) => {
    if (!window.confirm(`Excluir o modelo "${m.titulo}"?`)) return;
    await chamar(`/api/atendimento/respostas-rapidas/${m.id}`, "DELETE", null, "Modelo excluído.");
  };

  const visiveis = filtro === "todas" ? lista : lista.filter((m) => (m.categoria || "geral") === filtro);

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">Textos prontos para as conversas (digite <b>/</b> + atalho) e para os campos de mensagem de Régua, Campanhas e avisos (botão “Usar modelo”). Variáveis comuns: {VARIAVEIS.map((v) => <code key={v} className="mr-1">{v}</code>)}. Em conversas só <code>{"{{nome}}"}</code> e <code>{"{{empresa}}"}</code> são trocadas; nos envios automáticos valem as variáveis de cada tela.</p>
      {!temCategoria && <p className="text-sm text-yellow-300">Rode a migration 062 no servidor para usar categorias (os modelos seguem funcionando sem elas).</p>}

      <form onSubmit={salvar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-200">{form.id ? "Editar modelo" : "Novo modelo"}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input value={form.atalho} onChange={(e) => setForm({ ...form, atalho: e.target.value })} maxLength={31} placeholder="Atalho (ex.: renovar)" className={inputCls} aria-label="Atalho" />
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} maxLength={60} placeholder="Título" className={inputCls} aria-label="Título" />
          <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className={inputCls} aria-label="Categoria" disabled={!temCategoria}>
            {Object.entries(categorias).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <textarea value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} maxLength={1000} rows={4} placeholder="Texto do modelo" className={`${inputCls} resize-none`} aria-label="Texto" />
        {msg && <p className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
        <div className="flex gap-2 flex-wrap">
          <button type="submit" disabled={busy || !form.atalho.trim() || !form.titulo.trim() || !form.texto.trim()} className={btnPrimario}>{form.id ? "Salvar" : "Adicionar"}</button>
          {form.id && <button type="button" className={btnSecundario} onClick={() => { setForm(VAZIO); setMsg(null); }}>Cancelar</button>}
          <button type="button" disabled={busy} className={btnSecundario} onClick={() => chamar("/api/atendimento/respostas-rapidas/padrao", "POST", null, (d) => ((d.criados || d.recategorizados) ? `${d.criados || 0} modelo(s) criado(s)` + (d.recategorizados ? `, ${d.recategorizados} movido(s) para a categoria certa.` : ".") : "Os modelos padrão já existem."))}>Criar modelos padrão</button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {[["todas", "Todas"], ...Object.entries(categorias)].map(([k, v]) => (
          <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${filtro === k ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{v}</button>
        ))}
      </div>

      <ul className="space-y-2">
        {visiveis.length === 0 && <li className="text-sm text-gray-500">Nenhum modelo nesta categoria.</li>}
        {visiveis.map((m) => (
          <li key={m.id} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-100">{m.titulo}</span>
              <code className="text-xs text-gray-400">/{m.atalho}</code>
              {temCategoria && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">{categorias[m.categoria] || "Geral"}</span>}
              <span className="ml-auto flex gap-3 text-sm">
                <button onClick={() => { setForm({ id: m.id, atalho: m.atalho, titulo: m.titulo, categoria: m.categoria || "geral", texto: m.texto }); setMsg(null); }} className="text-blue-400 hover:text-blue-300 cursor-pointer">Editar</button>
                <button onClick={() => excluir(m)} className="text-red-400 hover:text-red-300 cursor-pointer">Excluir</button>
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{m.texto}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
