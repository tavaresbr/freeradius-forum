import React, { useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

export const CORES = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#64748b"];

export default function GerenciarEtiquetas({ headers, etiquetas, onFechar, onMudou }) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES[0]);
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
      ? await enviar(`/api/atendimento/etiquetas/${editId}`, "PUT", { nome, cor })
      : await enviar("/api/atendimento/etiquetas", "POST", { nome, cor });
    if (ok) { setNome(""); setCor(CORES[0]); setEditId(null); }
  };

  const excluir = async (et) => {
    if (!window.confirm(`Excluir a etiqueta "${et.nome}"? Ela sai de todas as conversas.`)) return;
    await enviar(`/api/atendimento/etiquetas/${et.id}`, "DELETE");
  };

  return (
    <Modal titulo="Etiquetas" onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="Nome da etiqueta (ex.: Financeiro)" className={inputCls} />
        <div className="flex gap-2 flex-wrap">
          {CORES.map((c) => (
            <button type="button" key={c} onClick={() => setCor(c)} aria-label={`Cor ${c}`} style={{ background: c }}
              className={`w-7 h-7 rounded-full cursor-pointer ${cor === c ? "ring-2 ring-offset-2 ring-offset-[#1a1d27] ring-white" : ""}`} />
          ))}
        </div>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !nome.trim()} className={btnPrimary}>{editId ? "Salvar" : "Adicionar"}</button>
          {editId && <button type="button" className={btnSecondary} onClick={() => { setEditId(null); setNome(""); setCor(CORES[0]); }}>Cancelar</button>}
        </div>
      </form>
      <ul className="divide-y divide-gray-800">
        {etiquetas.length === 0 && <li className="py-3 text-sm text-gray-500">Nenhuma etiqueta criada.</li>}
        {etiquetas.map((et) => (
          <li key={et.id} className="py-2 flex items-center gap-3">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: et.cor }} />
            <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{et.nome}</span>
            <button onClick={() => { setEditId(et.id); setNome(et.nome); setCor(et.cor); }} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">editar</button>
            <button onClick={() => excluir(et)} className="text-xs text-red-400 hover:text-red-300 cursor-pointer">excluir</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
