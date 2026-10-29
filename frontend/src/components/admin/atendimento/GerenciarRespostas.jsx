import React, { useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

export default function GerenciarRespostas({ headers, respostas, onFechar, onMudou }) {
  const vazio = { atalho: "", titulo: "", texto: "" };
  const [f, setF] = useState(vazio);
  const [editId, setEditId] = useState(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const enviar = async (url, metodo, corpo) => {
    setBusy(true);
    setErro("");
    try {
      const res = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Erro ao salvar"); return false; }
      await onMudou();
      return true;
    } catch {
      setErro("Erro de conexão");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const salvar = async (e) => {
    e.preventDefault();
    const ok = editId
      ? await enviar(`/api/atendimento/respostas-rapidas/${editId}`, "PUT", f)
      : await enviar("/api/atendimento/respostas-rapidas", "POST", f);
    if (ok) { setF(vazio); setEditId(null); }
  };

  const excluir = async (r) => {
    if (!window.confirm(`Excluir a resposta "/${r.atalho}"?`)) return;
    await enviar(`/api/atendimento/respostas-rapidas/${r.id}`, "DELETE");
  };

  return (
    <Modal titulo="Respostas rápidas" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={f.atalho} onChange={(e) => setF({ ...f, atalho: e.target.value })} maxLength={31} placeholder="Atalho (ex.: ola)" className={inputCls} />
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={60} placeholder="Título (ex.: Saudação)" className={inputCls} />
        </div>
        <textarea value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} maxLength={1000} rows={4} placeholder="Texto. Use {{nome}} e {{empresa}} se quiser." className={`${inputCls} resize-none`} />
        <p className="text-xs text-gray-500">No atendimento, digite <strong>/</strong> e o atalho para usar. <code>{"{{nome}}"}</code> vira o primeiro nome do cliente e <code>{"{{empresa}}"}</code> o nome da sua empresa.</p>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !f.atalho.trim() || !f.titulo.trim() || !f.texto.trim()} className={btnPrimary}>{editId ? "Salvar" : "Adicionar"}</button>
          {editId && <button type="button" className={btnSecondary} onClick={() => { setEditId(null); setF(vazio); }}>Cancelar</button>}
        </div>
      </form>
      <ul className="divide-y divide-gray-800">
        {respostas.length === 0 && <li className="py-3 text-sm text-gray-500">Nenhuma resposta criada.</li>}
        {respostas.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-center gap-3">
              <code className="text-xs text-blue-300">/{r.atalho}</code>
              <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{r.titulo}</span>
              <button onClick={() => { setEditId(r.id); setF({ atalho: r.atalho, titulo: r.titulo, texto: r.texto }); }} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">editar</button>
              <button onClick={() => excluir(r)} className="text-xs text-red-400 hover:text-red-300 cursor-pointer">excluir</button>
            </div>
            <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">{r.texto}</p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
