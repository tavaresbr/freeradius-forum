import React, { useCallback, useEffect, useState } from "react";
import SeletorModelo from "./SeletorModelo";

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const ROTULO_ANT = { 15: "15 min", 30: "30 min", 60: "1 hora", 180: "3 horas", 720: "12 horas", 1440: "1 dia", 2880: "2 dias" };
const STATUS = { agendada: "Agendada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
const VAZIO = {
  id: null, titulo: "", mensagem: "Olá, {{nome}}! Teremos uma manutenção programada em {{equipamento}} de {{inicio}} até {{fim}}. Durante esse período a internet pode ficar indisponível. Obrigado pela compreensão.",
  mensagem_fim: "", equipamento_id: "", inicio_em: "", fim_em: "", antecedencias: [1440, 60], aviso_fim: true, avisar_clientes: true, janela_dias: 30,
};
const paraInput = (v) => (v ? String(v).replace(" ", "T").slice(0, 16) : "");
const fmt = (v) => { const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v || "")); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "-"; };

// Manutenções programadas: agenda por equipamento, avisos aos clientes (antes e depois) e silêncio dos alertas da equipe.
export default function Manutencoes({ headers }) {
  const [quando, setQuando] = useState("futuras");
  const [dados, setDados] = useState({ manutencoes: [], antecedencias: [], pronto: true });
  const [equipamentos, setEquipamentos] = useState([]);
  const [form, setForm] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/atendimento/manutencoes?quando=${quando}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setDados(d); else setMsg({ tipo: "erro", texto: d.error || "Não foi possível carregar" });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quando]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/mikrotiks", { headers }).then((r) => (r.ok ? r.json() : [])).then((d) => setEquipamentos(Array.isArray(d) ? d : d.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const alternarAnt = (a) => setForm((f) => {
    const s = new Set(f.antecedencias);
    if (s.has(a)) s.delete(a); else s.add(a);
    return { ...f, antecedencias: [...s].sort((x, y) => y - x) };
  });
  const abrir = (m) => { setPrevia(null); setMsg(null); setForm(m ? { ...VAZIO, ...m, equipamento_id: m.equipamento_id || "", inicio_em: paraInput(m.inicio_em), fim_em: paraInput(m.fim_em), mensagem_fim: m.mensagem_fim || "" } : { ...VAZIO }); };

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

  const calcularPrevia = async () => {
    const d = await chamar("/api/atendimento/manutencoes/previa", "POST", { equipamento_id: form.equipamento_id || null, janela_dias: form.janela_dias });
    if (d) setPrevia(d);
  };
  const salvar = async (e) => {
    e.preventDefault();
    const d = await chamar(form.id ? `/api/atendimento/manutencoes/${form.id}` : "/api/atendimento/manutencoes", form.id ? "PUT" : "POST", { ...form, equipamento_id: form.equipamento_id || null });
    if (d) { setForm(null); setMsg({ tipo: "ok", texto: "Manutenção salva." }); carregar(); }
  };
  const cancelar = async (m) => {
    if (!window.confirm(`Cancelar a manutenção "${m.titulo}"? Os avisos que ainda não saíram serão interrompidos.`)) return;
    if (await chamar(`/api/atendimento/manutencoes/${m.id}/cancelar`, "POST")) { setMsg({ tipo: "ok", texto: "Manutenção cancelada." }); carregar(); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">Programe a manutenção de um equipamento: os clientes que usaram aquele equipamento recebem um aviso por WhatsApp antes (e, se quiser, depois), e os alertas de “equipamento offline” para a equipe ficam em silêncio durante a janela. Nada é enviado sem você criar a manutenção aqui.</p>
      {msg && <p role="status" className={`text-sm ${msg.tipo === "erro" ? "text-red-400" : "text-green-400"}`}>{msg.texto}</p>}
      {dados.pronto === false && <p className="text-sm text-yellow-300">{dados.aviso || "Rode a migration 064 no servidor."}</p>}

      <div className="flex flex-wrap gap-2 items-center">
        {[["futuras", "Próximas"], ["passadas", "Passadas"]].map(([id, t]) => (
          <button key={id} onClick={() => setQuando(id)} aria-pressed={quando === id}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${quando === id ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{t}</button>
        ))}
        <button className={`${btnPrimario} ml-auto`} disabled={dados.pronto === false} onClick={() => abrir(null)}>Nova manutenção</button>
      </div>

      {dados.manutencoes.length === 0 ? <p className="text-sm text-gray-500">Nenhuma manutenção {quando === "futuras" ? "programada" : "no histórico"}.</p> : (
        <table className="w-full text-sm text-gray-300">
          <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Título</th><th>Equipamento</th><th>Janela</th><th>Avisos</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados.manutencoes.map((m) => (
              <tr key={m.id} className="border-t border-gray-800 align-top">
                <td className="py-2">{m.titulo}</td>
                <td>{m.equipamento_nome || "Todos"}</td>
                <td>{fmt(m.inicio_em)} → {fmt(m.fim_em)}</td>
                <td>{m.avisar_clientes ? `${m.enviados}/${m.destinatarios} enviados` : "Sem aviso"}</td>
                <td>{STATUS[m.status] || m.status}</td>
                <td className="text-right whitespace-nowrap">
                  {m.status === "agendada" && <button className="text-blue-400 hover:text-blue-300 text-xs mr-3 cursor-pointer" onClick={() => abrir(m)}>Editar</button>}
                  {(m.status === "agendada" || m.status === "em_andamento") && <button className="text-red-400 hover:text-red-300 text-xs cursor-pointer" onClick={() => cancelar(m)}>Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={salvar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3">
            <h2 className="text-lg font-semibold text-white">{form.id ? "Editar manutenção" : "Nova manutenção"}</h2>
            <label className="text-xs text-gray-400 block">Título
              <input className={inputCls} value={form.titulo} maxLength={150} onChange={(e) => set("titulo", e.target.value)} required />
            </label>
            <label className="text-xs text-gray-400 block">Equipamento
              <select className={inputCls} value={form.equipamento_id} onChange={(e) => { set("equipamento_id", e.target.value); setPrevia(null); }}>
                <option value="">Todos os equipamentos</option>
                {equipamentos.map((eq) => <option key={eq.id} value={eq.id}>{eq.nome}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-400">Início
                <input type="datetime-local" className={inputCls} value={form.inicio_em} onChange={(e) => set("inicio_em", e.target.value)} required />
              </label>
              <label className="text-xs text-gray-400">Fim
                <input type="datetime-local" className={inputCls} value={form.fim_em} onChange={(e) => set("fim_em", e.target.value)} required />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
              <input type="checkbox" checked={form.avisar_clientes} onChange={(e) => set("avisar_clientes", e.target.checked)} /> Avisar os clientes por WhatsApp
            </label>
            {form.avisar_clientes && (
              <>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Avisar quanto tempo antes (até 3)</p>
                  <div className="flex gap-1 flex-wrap">
                    {(dados.antecedencias.length ? dados.antecedencias : Object.keys(ROTULO_ANT).map(Number)).map((a) => (
                      <button type="button" key={a} aria-pressed={form.antecedencias.includes(a)} onClick={() => alternarAnt(a)}
                        className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${form.antecedencias.includes(a) ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300"}`}>{ROTULO_ANT[a] || `${a} min`}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                    <span className="text-xs text-gray-400">Mensagem (variáveis: {"{{nome}} {{equipamento}} {{inicio}} {{fim}}"})</span>
                    <SeletorModelo headers={headers} categoria="manutencao" onEscolher={(t) => set("mensagem", t.slice(0, 1000))} />
                  </div>
                  <textarea className={inputCls} rows={4} maxLength={1000} value={form.mensagem} onChange={(e) => set("mensagem", e.target.value)} required />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={form.aviso_fim} onChange={(e) => set("aviso_fim", e.target.checked)} /> Avisar quando terminar
                </label>
                {form.aviso_fim && (
                  <label className="text-xs text-gray-400 block">Mensagem final (vazio = texto padrão)
                    <textarea className={inputCls} rows={2} maxLength={1000} value={form.mensagem_fim} onChange={(e) => set("mensagem_fim", e.target.value)} />
                  </label>
                )}
                <label className="text-xs text-gray-400 block max-w-[220px]">Quem usou o equipamento nos últimos (dias)
                  <input type="number" min={1} max={365} className={inputCls} value={form.janela_dias} onChange={(e) => { set("janela_dias", e.target.value); setPrevia(null); }} />
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" className={btnSecundario} disabled={busy} onClick={calcularPrevia}>Ver quem vai receber</button>
                  {previa && (
                    <span className="text-sm text-gray-300">
                      <b>{previa.total}</b> cliente(s){previa.excedeu ? ` (limite de ${previa.limite})` : ""}; {previa.bloqueados} fora por pedirem para não receber.
                      {previa.amostra?.length ? ` Ex.: ${previa.amostra.map((a) => `${a.nome || "cliente"} ${a.telefone}`).join(", ")}` : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-yellow-300">Atenção: avisos em massa aumentam o risco de bloqueio do número pelo WhatsApp. O envio é espaçado e respeita o horário de silêncio.</p>
              </>
            )}
            {msg?.tipo === "erro" && <p className="text-sm text-red-400">{msg.texto}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className={btnSecundario} onClick={() => setForm(null)}>Fechar</button>
              <button className={btnPrimario} disabled={busy}>Salvar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
