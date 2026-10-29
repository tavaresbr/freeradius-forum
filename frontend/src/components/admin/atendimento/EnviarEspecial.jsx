import React, { useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";
import { lerCoordenadas } from "../../../utils/coordenadas";

// Envia uma localizacao (tipo "local") ou um contato (tipo "contato") na conversa aberta.
export default function EnviarEspecial({ tipo, conversaId, headers, onFechar, onEnviado }) {
  const local = tipo === "local";
  const [coords, setCoords] = useState("");
  const [nome, setNome] = useState("");
  const [detalhe, setDetalhe] = useState(""); // endereco (local) ou telefone (contato)
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro("");
    let corpo;
    if (local) {
      const c = lerCoordenadas(coords);
      if (!c) { setErro("Não entendi as coordenadas. Cole um link do Google Maps ou escreva: -1.4558, -48.5044"); return; }
      corpo = { ...c, nome, endereco: detalhe };
    } else {
      corpo = { nome, telefone: detalhe };
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/atendimento/conversas/${conversaId}/${local ? "localizacao" : "contato"}`, { method: "POST", headers, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível enviar"); return; }
      onEnviado();
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo={local ? "Enviar localização" : "Enviar contato"} onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-3">
        {local ? (
          <>
            <input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="Link do Google Maps ou coordenadas (-1.4558, -48.5044)" className={inputCls} autoFocus />
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Nome do lugar (opcional)" className={inputCls} />
            <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} maxLength={200} placeholder="Endereço (opcional)" className={inputCls} />
          </>
        ) : (
          <>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Nome do contato" className={inputCls} autoFocus />
            <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Telefone com DDD (ex.: 93 99999-0000)" inputMode="tel" className={inputCls} />
          </>
        )}
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || (local ? !coords.trim() : !nome.trim() || !detalhe.trim())} className={btnPrimary}>{busy ? "Enviando..." : "Enviar"}</button>
          <button type="button" className={btnSecondary} onClick={onFechar}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
