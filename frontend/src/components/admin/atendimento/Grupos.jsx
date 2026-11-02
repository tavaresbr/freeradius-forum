import React, { useCallback, useEffect, useState } from "react";

const inputCls = "px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const fmtData = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString("pt-BR") : ""; };

// Grupos do WhatsApp de cada número: cada número só vê os próprios. Importa os membros como clientes com a origem do grupo.
export default function Grupos({ headers }) {
  const [numeros, setNumeros] = useState([{ id: 0, nome: "Principal" }]);
  const [numeroId, setNumeroId] = useState(0);
  const [grupos, setGrupos] = useState([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [alvo, setAlvo] = useState(null); // { grupo, previa, resultado }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/atendimento/numeros", { headers }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.numeros?.length) setNumeros(d.numeros); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async (atualizar = false) => {
    setCarregando(true); setMsg(null);
    try {
      const r = await fetch(`/api/atendimento/grupos?numero_id=${numeroId}${atualizar ? "&atualizar=1" : ""}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setGrupos(d.grupos || []); else { setGrupos([]); setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar os grupos" }); }
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    setCarregando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroId]);
  useEffect(() => { carregar(); }, [carregar]);

  const url = (g, fim) => `/api/atendimento/grupos/${encodeURIComponent(g.jid)}/${fim}`;
  const abrir = async (g) => {
    setAlvo({ grupo: g, previa: null, resultado: null }); setBusy(true);
    try {
      const r = await fetch(`${url(g, "previa")}?numero_id=${numeroId}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAlvo({ grupo: g, previa: d, resultado: null }); else { setAlvo(null); setMsg({ tipo: "erro", texto: d.error || "Não foi possível ler o grupo" }); }
    } catch { setAlvo(null); setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    setBusy(false);
  };
  const importar = async () => {
    setBusy(true);
    try {
      const r = await fetch(url(alvo.grupo, "importar"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ numero_id: numeroId, confirmar: true }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setAlvo((a) => ({ ...a, resultado: d })); carregar(); } else setMsg({ tipo: "erro", texto: d.error || "Não foi possível importar" });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    setBusy(false);
  };
  const exportar = async (g) => {
    try {
      const r = await fetch(`${url(g, "membros/export")}?numero_id=${numeroId}`, { headers });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return setMsg({ tipo: "erro", texto: d.error || "Não foi possível exportar" }); }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob()); a.download = "membros-grupo.csv"; a.click(); URL.revokeObjectURL(a.href);
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
  };

  const filtrados = grupos.filter((g) => g.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {numeros.length > 1 && (
          <select aria-label="Número" value={numeroId} onChange={(e) => setNumeroId(Number(e.target.value))} className={inputCls}>
            {numeros.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
          </select>
        )}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo" className={`${inputCls} min-w-0 flex-1`} />
        <button onClick={() => carregar(true)} disabled={carregando} className={btnSecundario}>{carregando ? "Carregando..." : "Atualizar"}</button>
      </div>
      <p className="text-xs text-gray-500">Cada número mostra só os seus grupos. Importar cria clientes com a origem “grupo”, sem CPF e sem aceite de marketing: participar de um grupo não é consentimento para promoções.</p>
      {msg && <p role="alert" className="text-sm text-red-400">{msg.texto}</p>}
      {!carregando && !msg && !filtrados.length && <p className="text-sm text-gray-400">Nenhum grupo encontrado neste número.</p>}
      <ul className="space-y-2">
        {filtrados.map((g) => (
          <li key={g.jid} className="flex flex-wrap items-center gap-2 border border-gray-800 rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-100 truncate">{g.nome}</p>
              <p className="text-xs text-gray-500">{g.tamanho} participantes{g.importado ? ` · importado em ${fmtData(g.importado.quando)} (${g.importado.total} contatos)` : ""}</p>
            </div>
            <button onClick={() => abrir(g)} className={btnPrimario}>{g.importado ? "Importar novos" : "Importar membros"}</button>
            <button onClick={() => exportar(g)} className={btnSecundario}>CSV</button>
          </li>
        ))}
      </ul>
      {alvo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={() => !busy && setAlvo(null)}>
          <div role="dialog" aria-label="Importar membros" className="bg-[#161a26] border border-gray-800 rounded-xl p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-gray-100 font-medium">{alvo.grupo.nome}</h2>
            {!alvo.previa && <p className="text-sm text-gray-400">Lendo os membros...</p>}
            {alvo.previa && !alvo.resultado && (
              <>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>Participantes: {alvo.previa.total}</li>
                  <li>Com número utilizável: {alvo.previa.com_numero}</li>
                  <li>Já cadastrados (só ganham a marca do grupo): {alvo.previa.ja_cadastrados}</li>
                  <li className="text-green-400">Novos clientes: {alvo.previa.novos}</li>
                  {alvo.previa.sem_numero > 0 && <li className="text-gray-500">{alvo.previa.sem_numero} sem número visível (não importados)</li>}
                </ul>
                {alvo.previa.excede_limite && <p className="text-sm text-red-400">Grupo grande demais (máximo 1000 com número).</p>}
                <p className="text-xs text-gray-500">Será criada a etiqueta “Grupo: {alvo.grupo.nome.slice(0, 31)}” e a origem fica salva em cada cliente.</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setAlvo(null)} disabled={busy} className={btnSecundario}>Cancelar</button>
                  <button onClick={importar} disabled={busy || alvo.previa.excede_limite || !alvo.previa.com_numero} className={btnPrimario}>{busy ? "Importando..." : "Confirmar importação"}</button>
                </div>
              </>
            )}
            {alvo.resultado && (
              <>
                <p className="text-sm text-green-400">Pronto: {alvo.resultado.criados} novos clientes, {alvo.resultado.ja_existiam} já existiam. Etiqueta: {alvo.resultado.etiqueta}.</p>
                <div className="flex justify-end"><button onClick={() => setAlvo(null)} className={btnPrimario}>Fechar</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
