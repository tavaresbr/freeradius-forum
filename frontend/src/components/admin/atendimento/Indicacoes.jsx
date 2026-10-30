import React, { useCallback, useEffect, useState } from "react";

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const STATUS = { cadastrada: "Cadastrada", comprou: "Comprou", recompensada: "Recompensada", recusada: "Recusada" };
const MOTIVO = { limite_mensal: "Limite mensal do indicador", programa_desligado: "Programa desligado", revogada: "Recompensa revogada", cupom_nao_gerado: "Cupom não gerado" };
const fmt = (v) => (v ? new Date(v).toLocaleDateString("pt-BR") : "-");

// Campo de desconto: percentual (1-99) ou valor em reais (a API guarda em centavos).
function Desconto({ rotulo, valor, onChange }) {
  const reais = valor.tipo === "valor";
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{rotulo}</p>
      <div className="flex gap-2">
        <select className={`${inputCls} max-w-[140px]`} value={valor.tipo} onChange={(e) => onChange({ tipo: e.target.value, valor: e.target.value === "valor" ? 500 : 10 })}>
          <option value="percentual">Percentual</option>
          <option value="valor">Valor (R$)</option>
        </select>
        <input type="number" min={1} step={reais ? "0.01" : "1"} max={reais ? undefined : 99} className={`${inputCls} max-w-[140px]`}
          value={reais ? (valor.valor / 100).toString() : valor.valor}
          onChange={(e) => onChange({ ...valor, valor: reais ? Math.round(Number(e.target.value) * 100) : Number(e.target.value) })} />
      </div>
    </div>
  );
}

// Indicações: cliente indica cliente. O indicado ganha desconto na 1ª compra e o indicador ganha um cupom único.
export default function Indicacoes({ headers }) {
  const [cfg, setCfg] = useState(null);
  const [lista, setLista] = useState({ itens: [], resumo: {}, ranking: [], pronto: true });
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [achados, setAchados] = useState([]);
  const [convite, setConvite] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/atendimento/indicacoes${status ? `?status=${status}` : ""}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setLista(d); else setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar" });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/atendimento/indicacoes/config", { headers }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setCfg(d.config)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setAchados([]); return undefined; }
    const t = setTimeout(() => {
      fetch(`/api/atendimento/clientes?q=${encodeURIComponent(q.trim())}`, { headers }).then((r) => (r.ok ? r.json() : { clientes: [] })).then((d) => setAchados(d.clientes || [])).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const chamar = async (url, metodo, corpo) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível concluir" }); return null; }
      return d;
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); return null; }
    finally { setBusy(false); }
  };

  const salvar = async (e) => {
    e.preventDefault();
    const d = await chamar("/api/atendimento/indicacoes/config", "PUT", cfg);
    if (d) { setCfg(d.config); setMsg({ tipo: "ok", texto: "Configuração salva." }); }
  };
  const gerar = async (c, enviar) => {
    if (enviar && !window.confirm(`Enviar o convite por WhatsApp para ${c.nome || "o cliente"}?`)) return;
    const d = await chamar("/api/atendimento/indicacoes/convite", "POST", { lead_id: c.id, enviar });
    if (d) { setConvite({ ...d, cliente: c }); if (enviar) setMsg({ tipo: "ok", texto: "Convite enviado." }); }
  };
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); setMsg({ tipo: "ok", texto: "Copiado." }); } catch { setMsg({ tipo: "erro", texto: "Não foi possível copiar." }); } };
  const revogar = async (i) => {
    if (!window.confirm("Revogar a recompensa? O cupom do indicador será desativado (só se ainda não foi usado).")) return;
    if (await chamar(`/api/atendimento/indicacoes/${i.id}/revogar`, "POST")) { setMsg({ tipo: "ok", texto: "Recompensa revogada." }); carregar(); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">O cliente indica um amigo com o código dele: o amigo ganha desconto na <b>primeira compra</b> e, quando ela for aprovada, o cliente ganha um <b>cupom único</b>. Todo cálculo é feito no servidor; indicar a si mesmo, repetir CPF ou passar do limite mensal é recusado.</p>
      {msg && <p role="status" className={`text-sm ${msg.tipo === "erro" ? "text-red-400" : "text-green-400"}`}>{msg.texto}</p>}
      {lista.pronto === false && <p className="text-sm text-yellow-300">{lista.aviso || "Rode a migration 066 no servidor."}</p>}

      {cfg && (
        <form onSubmit={salvar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} /> Programa de indicações ligado
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <Desconto rotulo="Desconto do amigo (1ª compra)" valor={cfg.desconto_indicado} onChange={(v) => setCfg({ ...cfg, desconto_indicado: v })} />
            <Desconto rotulo="Recompensa de quem indicou (cupom único)" valor={cfg.recompensa_indicador} onChange={(v) => setCfg({ ...cfg, recompensa_indicador: v })} />
            <label className="text-xs text-gray-400">Validade do cupom (dias)
              <input type="number" min={1} max={365} className={inputCls} value={cfg.validade_cupom_dias} onChange={(e) => setCfg({ ...cfg, validade_cupom_dias: e.target.value })} />
            </label>
            <label className="text-xs text-gray-400">Máximo de indicações por cliente por mês
              <input type="number" min={1} max={100} className={inputCls} value={cfg.limite_por_indicador_mes} onChange={(e) => setCfg({ ...cfg, limite_por_indicador_mes: e.target.value })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.exigir_compra_do_indicador} onChange={(e) => setCfg({ ...cfg, exigir_compra_do_indicador: e.target.checked })} /> Só quem já comprou pode indicar
          </label>
          <label className="text-xs text-gray-400 block">Mensagem do convite ({"{{nome}} {{empresa}} {{codigo}} {{link}}"})
            <textarea className={inputCls} rows={3} maxLength={1000} value={cfg.mensagem_convite} onChange={(e) => setCfg({ ...cfg, mensagem_convite: e.target.value })} />
          </label>
          <button className={btnPrimario} disabled={busy}>Salvar</button>
        </form>
      )}

      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
        <h2 className="text-base font-semibold text-white">Gerar convite</h2>
        <input className={inputCls} placeholder="Buscar cliente por nome, telefone ou e-mail" value={q} onChange={(e) => { setQ(e.target.value); setConvite(null); }} />
        {achados.length > 0 && (
          <ul className="space-y-1">
            {achados.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-300 border-t border-gray-800 pt-1">
                <span className="flex-1 min-w-[140px]">{c.nome || "(sem nome)"} <span className="text-gray-500">{c.telefone || ""}</span></span>
                <button className={btnSecundario} disabled={busy || !cfg?.ativo} onClick={() => gerar(c, false)}>Ver código</button>
                <button className={btnSecundario} disabled={busy || !cfg?.ativo || !c.telefone} onClick={() => gerar(c, true)}>Enviar por WhatsApp</button>
              </li>
            ))}
          </ul>
        )}
        {!cfg?.ativo && <p className="text-xs text-gray-500">Ligue e salve o programa para gerar convites.</p>}
        {convite && (
          <div className="bg-[#0f111a] border border-gray-800 rounded-lg p-3 text-sm space-y-1">
            <p className="text-gray-300">Código de {convite.cliente.nome || "cliente"}: <b className="text-white">{convite.codigo}</b></p>
            {convite.link && <p className="text-gray-400 break-all">{convite.link} <button className="text-blue-400 ml-2 cursor-pointer" onClick={() => copiar(convite.link)}>copiar</button></p>}
            <p className="text-gray-400 whitespace-pre-line">{convite.mensagem} <button className="text-blue-400 ml-2 cursor-pointer" onClick={() => copiar(convite.mensagem)}>copiar</button></p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {[["", "Todas"], ["cadastrada", "Cadastradas"], ["recompensada", "Recompensadas"], ["recusada", "Recusadas"]].map(([id, t]) => (
          <button key={id || "todas"} onClick={() => setStatus(id)} aria-pressed={status === id}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${status === id ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{t}{id && lista.resumo?.[id] ? ` (${lista.resumo[id]})` : ""}</button>
        ))}
      </div>

      {lista.itens.length === 0 ? <p className="text-sm text-gray-500">Nenhuma indicação ainda.</p> : (
        <table className="w-full text-sm text-gray-300">
          <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Indicou</th><th>Amigo (CPF)</th><th>Situação</th><th>Cupom</th><th>Data</th><th></th></tr></thead>
          <tbody>
            {lista.itens.map((i) => (
              <tr key={i.id} className="border-t border-gray-800">
                <td className="py-2">{i.indicador_nome || "-"}</td>
                <td>{i.indicado_cpf}</td>
                <td>{STATUS[i.status] || i.status}{i.motivo ? ` · ${MOTIVO[i.motivo] || i.motivo}` : ""}</td>
                <td>{i.cupom_codigo ? `${i.cupom_codigo}${Number(i.cupom_usos) ? " (usado)" : ""}` : "-"}</td>
                <td>{fmt(i.criado_em)}</td>
                <td className="text-right">{i.status === "recompensada" && !Number(i.cupom_usos) && <button className="text-red-400 hover:text-red-300 text-xs cursor-pointer" onClick={() => revogar(i)}>Revogar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lista.ranking?.length > 0 && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4">
          <h2 className="text-base font-semibold text-white mb-2">Quem mais indicou</h2>
          <ol className="list-decimal pl-5 text-sm text-gray-300 space-y-1">
            {lista.ranking.map((r, n) => <li key={`${r.nome}-${n}`}>{r.nome} — {r.indicacoes}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
