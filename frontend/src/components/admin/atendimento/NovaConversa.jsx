import React, { useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

export default function NovaConversa({ headers, onFechar, onAbrir, numeros = [] }) {
  const [numeroId, setNumeroId] = useState(0);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const iniciar = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErro("");
    try {
      const res = await fetch("/api/atendimento/conversas", { method: "POST", headers, body: JSON.stringify({ telefone, nome, texto, numero_id: numeroId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível iniciar a conversa"); return; }
      onAbrir(data.id);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo="Nova conversa" onFechar={onFechar}>
      <form onSubmit={iniciar} className="space-y-3">
        {numeros.length > 1 && (
          <select value={numeroId} onChange={(e) => setNumeroId(Number(e.target.value))} className={inputCls} aria-label="Enviar pelo número">
            {numeros.map((n) => <option key={n.id} value={n.id}>Enviar pelo número: {n.nome}</option>)}
          </select>
        )}
        <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone com DDD (ex.: 93 99999-0000)" inputMode="tel" className={inputCls} autoFocus />
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} placeholder="Nome (opcional)" className={inputCls} />
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} rows={4} placeholder="Primeira mensagem (opcional)" className={`${inputCls} resize-none`} />
        <p className="text-xs text-yellow-400">
          Cuidado: mandar mensagem para quem não falou com você primeiro pode levar o WhatsApp a bloquear o número. Use só com contatos que esperam ouvir de você.
        </p>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !telefone.trim()} className={btnPrimary}>{busy ? "Abrindo..." : texto.trim() ? "Enviar e abrir" : "Abrir conversa"}</button>
          <button type="button" className={btnSecondary} onClick={onFechar}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
