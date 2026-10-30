import React, { useCallback, useEffect, useState } from "react";
import AlertasEquipamentos from "../AlertasEquipamentos";
import SeletorModelo from "./SeletorModelo";

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const TIPO = { equipamento_offline: "Equipamento offline", whatsapp_desconectado: "WhatsApp desconectado", manual: "Registrado pela equipe", equipamento_online: "Equipamento online" };
const fmt = (v) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");
const dur = (min) => { const m = Number(min) || 0; return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

// Alertas técnicos: feed de quedas (equipamento, WhatsApp, avisos manuais) e aviso aos clientes afetados.
export default function AlertasTecnicos({ headers }) {
  const [estado, setEstado] = useState("abertos");
  const [dados, setDados] = useState({ itens: [], offline_agora: 0, pronto: true, config: null });
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(null);
  const [equipe, setEquipe] = useState(false);
  const [aviso, setAviso] = useState(null); // { alerta, tipo, previa }

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/atendimento/alertas-tecnicos?estado=${estado}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setDados(d); setCfg((c) => c || d.config || null); } else setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar" });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  useEffect(() => { carregar(); const t = setInterval(() => { if (!document.hidden) carregar(); }, 30000); return () => clearInterval(t); }, [carregar]);

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

  const salvarCfg = async (e) => {
    e.preventDefault();
    const d = await chamar("/api/atendimento/alertas-tecnicos/config", "PUT", cfg);
    if (d) { setCfg(d.config); setMsg({ tipo: "ok", texto: "Configuração salva." }); }
  };
  const criarManual = async (e) => {
    e.preventDefault();
    if (await chamar("/api/atendimento/alertas-tecnicos", "POST", manual)) { setManual(null); carregar(); }
  };
  const resolver = async (a) => { if (await chamar(`/api/atendimento/alertas-tecnicos/${a.id}/resolver`, "POST")) carregar(); };
  const abrirAviso = async (a, tipo) => {
    const d = await chamar(`/api/atendimento/alertas-tecnicos/${a.id}/previa`, "GET");
    if (d) setAviso({ alerta: a, tipo, previa: d });
  };
  const confirmarAviso = async () => {
    const d = await chamar(`/api/atendimento/alertas-tecnicos/${aviso.alerta.id}/avisar-clientes`, "POST", { tipo: aviso.tipo, confirmar: true });
    setAviso(null);
    if (d) { setMsg({ tipo: "ok", texto: "Aviso aos clientes na fila de envio." }); carregar(); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">Quedas de equipamento, WhatsApp desconectado e ocorrências registradas pela equipe. Os alertas de equipamento são registrados quando o monitoramento abaixo está ligado, e você escolhe se os clientes afetados são avisados por WhatsApp.</p>
      {msg && <p role="status" className={`text-sm ${msg.tipo === "erro" ? "text-red-400" : "text-green-400"}`}>{msg.texto}</p>}
      {dados.pronto === false && <p className="text-sm text-yellow-300">{dados.aviso || "Rode a migration 065 no servidor."}</p>}

      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <span className={`text-2xl font-bold ${dados.offline_agora ? "text-red-400" : "text-green-400"}`}>{dados.offline_agora}</span>
        <span className="text-sm text-gray-300">equipamento(s) offline agora</span>
        <div className="ml-auto flex gap-2 flex-wrap">
          <button className={btnSecundario} onClick={() => setEquipe(true)}>Alertas para a equipe</button>
          <button className={btnSecundario} disabled={dados.pronto === false} onClick={() => setManual({ titulo: "", detalhes: "" })}>Registrar ocorrência</button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[["abertos", "Abertos"], ["resolvidos", "Resolvidos"], ["todos", "Todos"]].map(([id, t]) => (
          <button key={id} onClick={() => setEstado(id)} aria-pressed={estado === id}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${estado === id ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{t}</button>
        ))}
      </div>

      {dados.itens.length === 0 ? <p className="text-sm text-gray-500">Nenhum alerta {estado === "abertos" ? "aberto" : "registrado"}.</p> : (
        <ul className="space-y-2">
          {dados.itens.map((a) => (
            <li key={a.id} className="bg-[#1a1d27] border border-gray-800 rounded-lg p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${a.resolvido_em ? "bg-green-500" : "bg-red-500"}`} aria-hidden="true" />
                <b className="text-gray-100">{a.titulo}</b>
                <span className="text-xs text-gray-500">{TIPO[a.tipo] || a.tipo}</span>
                <span className="text-xs text-gray-400 ml-auto">{fmt(a.criado_em)}{a.resolvido_em ? ` → ${fmt(a.resolvido_em)}` : ""} · {dur(a.duracao_min)}</span>
              </div>
              {a.detalhes && <p className="text-gray-400 mt-1">{a.detalhes}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {(a.tipo === "equipamento_offline" || a.tipo === "manual") && (
                  <>
                    {a.clientes_avisados_em ? <span className="text-xs text-green-400">Clientes avisados {fmt(a.clientes_avisados_em)}</span>
                      : <button className={btnSecundario} disabled={busy} onClick={() => abrirAviso(a, "queda")}>Avisar clientes agora</button>}
                    {a.resolvido_em && a.clientes_avisados_em && (a.clientes_volta_avisados_em
                      ? <span className="text-xs text-green-400">Volta avisada {fmt(a.clientes_volta_avisados_em)}</span>
                      : <button className={btnSecundario} disabled={busy} onClick={() => abrirAviso(a, "volta")}>Avisar que normalizou</button>)}
                  </>
                )}
                {a.tipo === "manual" && !a.resolvido_em && <button className={btnSecundario} disabled={busy} onClick={() => resolver(a)}>Marcar como resolvido</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {cfg && (
        <form onSubmit={salvarCfg} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
          <h2 className="text-base font-semibold text-white">Monitoramento e aviso aos clientes</h2>
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked, avisar_clientes_auto: e.target.checked ? cfg.avisar_clientes_auto : false })} />
            Monitorar equipamentos e registrar os alertas aqui (não envia nada sozinho)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.avisar_clientes_auto} disabled={!cfg.ativo} onChange={(e) => setCfg({ ...cfg, avisar_clientes_auto: e.target.checked })} />
            Avisar automaticamente os clientes do equipamento afetado
          </label>
          {cfg.avisar_clientes_auto && (
            <>
              <label className="text-xs text-gray-400 block max-w-[240px]">Avisar se a queda durar mais de (min)
                <input type="number" min={5} max={240} className={inputCls} value={cfg.apos_minutos} onChange={(e) => setCfg({ ...cfg, apos_minutos: e.target.value })} />
              </label>
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <span className="text-xs text-gray-400">Mensagem de queda ({"{{nome}} {{equipamento}} {{inicio}}"})</span>
                  <SeletorModelo headers={headers} categoria="manutencao" onEscolher={(t) => setCfg({ ...cfg, mensagem_queda: t.slice(0, 1000) })} />
                </div>
                <textarea className={inputCls} rows={3} maxLength={1000} value={cfg.mensagem_queda} onChange={(e) => setCfg({ ...cfg, mensagem_queda: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input type="checkbox" checked={cfg.avisar_volta} onChange={(e) => setCfg({ ...cfg, avisar_volta: e.target.checked })} /> Avisar quando normalizar
              </label>
              {cfg.avisar_volta && (
                <label className="text-xs text-gray-400 block">Mensagem de volta
                  <textarea className={inputCls} rows={2} maxLength={1000} value={cfg.mensagem_volta} onChange={(e) => setCfg({ ...cfg, mensagem_volta: e.target.value })} />
                </label>
              )}
              <p className="text-xs text-yellow-300">Atenção: avisos em massa aumentam o risco de bloqueio do número. Há 1 aviso por queda e o envio é espaçado. Para respeitar a noite, marque “Alertas técnicos (clientes)” em Não perturbe.</p>
            </>
          )}
          <button className={btnPrimario} disabled={busy}>Salvar</button>
        </form>
      )}

      {manual && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={criarManual} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 w-full max-w-md space-y-3">
            <h2 className="text-lg font-semibold text-white">Registrar ocorrência</h2>
            <label className="text-xs text-gray-400 block">Título
              <input className={inputCls} maxLength={150} value={manual.titulo} onChange={(e) => setManual({ ...manual, titulo: e.target.value })} required />
            </label>
            <label className="text-xs text-gray-400 block">Detalhes (opcional)
              <textarea className={inputCls} rows={3} maxLength={500} value={manual.detalhes} onChange={(e) => setManual({ ...manual, detalhes: e.target.value })} />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" className={btnSecundario} onClick={() => setManual(null)}>Fechar</button>
              <button className={btnPrimario} disabled={busy}>Registrar</button>
            </div>
          </form>
        </div>
      )}

      {aviso && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 w-full max-w-md space-y-3">
            <h2 className="text-lg font-semibold text-white">{aviso.tipo === "volta" ? "Avisar que normalizou" : "Avisar clientes agora"}</h2>
            <p className="text-sm text-gray-300"><b>{aviso.previa.total}</b> cliente(s) {aviso.alerta.equipamento_nome ? `de ${aviso.alerta.equipamento_nome} ` : ""}vão receber o aviso por WhatsApp ({aviso.previa.bloqueados} ficam de fora por pedirem para não receber).</p>
            <p className="text-xs text-yellow-300">Só é possível avisar uma vez por alerta.</p>
            <div className="flex gap-2 justify-end">
              <button className={btnSecundario} onClick={() => setAviso(null)}>Cancelar</button>
              <button className={btnPrimario} disabled={busy || !aviso.previa.total} onClick={confirmarAviso}>Enviar aviso</button>
            </div>
          </div>
        </div>
      )}

      {equipe && <AlertasEquipamentos onFechar={() => setEquipe(false)} />}
    </div>
  );
}
