import React, { useEffect, useState } from "react";

// "Usar modelo": preenche o campo de mensagem com um modelo da aba Modelos (o texto continua editavel).
export default function SeletorModelo({ headers, onEscolher, categoria }) {
  const [lista, setLista] = useState([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/respostas-rapidas", { headers })
      .then((r) => (r.ok ? r.json() : { respostas: [] }))
      .then((d) => vivo && setLista(d.respostas || []))
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opcoes = categoria ? lista.filter((m) => m.categoria === categoria || !m.categoria) : lista;
  if (!opcoes.length) return null;
  return (
    <select aria-label="Usar modelo" defaultValue="" onChange={(e) => { const m = lista.find((x) => String(x.id) === e.target.value); if (m) onEscolher(m.texto); e.target.value = ""; }}
      className="bg-[#0d1117] border border-gray-700 text-gray-300 px-2 py-1 rounded text-xs max-w-full">
      <option value="">📄 Usar modelo…</option>
      {opcoes.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
    </select>
  );
}
