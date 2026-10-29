import React, { useCallback, useEffect, useRef, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";
const STATUS = {
  rascunho: ["Rascunho", "bg-gray-800 text-gray-300"], em_andamento: ["Enviando", "bg-blue-900/40 text-blue-300"],
  pausada: ["Pausada", "bg-yellow-900/40 text-yellow-300"], concluida: ["Concluída", "bg-green-900/40 text-green-300"],
  cancelada: ["Cancelada", "bg-red-900/40 text-red-300"],
};
const MODELO = "Olá, {{nome}}! Estamos com uma instabilidade na internet neste momento e já estamos trabalhando para resolver. Pedimos desculpas pelo transtorno.";
const fmt = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "-");

// Aviso operacional (queda, manutencao) para quem esta CONECTADO agora. Respeita quem pediu para nao receber mensagens.
export default function AvisoOperacional() {
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [mensagem, setMensagem] = useState(MODELO);
  const [equipamento, setEquipamento] = useState("");
  const [equipamentos, setEquipamentos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [telefone, setTelefone] = useState("");
  const [lista, setLista] = useState([]);
  const [msg, setMsg] = useState(null); // { tipo: 'ok'|'erro', texto }
  const [busy, setBusy] = useState(false);
  const [aviso503, setAviso503] = useState(false);
  const listaRef = useRef([]);

  const corpo = () => ({ mensagem, equipamento_id: equipamento || null });

  const carregarLista = useCallback(async () => {
    try {
      const r = await fetch("/api/avisos-operacionais", { headers });
      const d = await r.json();
      setLista(d.data || []); listaRef.current = d.data || [];
      setAviso503(!!d.indisponivel);
    } catch { /* tenta de novo no proximo ciclo */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarLista();
    fetch("/api/mikrotiks", { headers }).then((r) => (r.ok ? r.json() : [])).then((d) => setEquipamentos(Array.isArray(d) ? d : [])).catch(() => {});
    const t = setInterval(() => { if (listaRef.current.some((e) => e.status === "em_andamento")) carregarLista(); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregarLista]);

  const chamar = async (url, method, body, ok) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível concluir" }); return null; }
      if (ok) setMsg({ tipo: "ok", texto: ok });
      return d;
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de conexão" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const verPrevia = async () => { const d = await chamar("/api/avisos-operacionais/previa", "POST", corpo()); if (d) setPrevia(d.data); };
  const testar = () => chamar("/api/avisos-operacionais/teste", "POST", { ...corpo(), telefone }, "Teste enviado.");
  const enviar = async () => {
    if (!previa || !window.confirm(`Enviar este aviso para ${previa.total} cliente(s) conectado(s) agora?`)) return;
    const c = await chamar("/api/avisos-operacionais", "POST", corpo());
    if (!c) return;
    const i = await chamar(`/api/avisos-operacionais/${c.data.id}/iniciar`, "POST", null, "Aviso em envio. Acompanhe abaixo.");
    if (i) setPrevia(null);
    carregarLista();
  };
  const acao = async (id, a) => { await chamar(`/api/avisos-operacionais/${id}/${a}`, "POST"); carregarLista(); };

  return (
    <AdminLayout>
      <div className="space-y-5 max-w-3xl">
        <h1 className="text-2xl font-bold text-white">Aviso operacional</h1>
        <p className="text-sm text-gray-400">Mande um aviso de serviço (queda, manutenção) por WhatsApp só para quem está conectado agora e tem telefone no cadastro. Quem pediu para não receber mensagens fica de fora. O envio é devagar, com intervalo entre as mensagens, para proteger o número.</p>
        {aviso503 && <p className="text-sm text-yellow-300">Rode a migration 057 no servidor para usar este recurso.</p>}

        <section className="bg-[#1a1d27] border border-gray-800 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Equipamento (opcional)</label>
            <select className={inputCls} value={equipamento} onChange={(e) => { setEquipamento(e.target.value); setPrevia(null); }} aria-label="Equipamento">
              <option value="">Todos os equipamentos</option>
              {equipamentos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mensagem (use {"{{nome}}"} para o primeiro nome)</label>
            <textarea className={`${inputCls} resize-none`} rows={4} maxLength={1000} value={mensagem} onChange={(e) => { setMensagem(e.target.value); setPrevia(null); }} />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className={btnSecundario} disabled={busy || !mensagem.trim()} onClick={verPrevia}>Ver prévia e total</button>
            <input className={`${inputCls} !w-44 min-w-0`} value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" placeholder="Teste: 93 99999-0000" aria-label="Telefone de teste" />
            <button className={btnSecundario} disabled={busy || !telefone.trim() || !mensagem.trim()} onClick={testar}>Enviar teste</button>
          </div>
          {previa && (
            <div className="border border-gray-800 rounded-lg p-3 space-y-2 text-sm">
              <p className="text-white"><strong>{previa.total}</strong> cliente(s) conectado(s) agora{previa.excedeu ? ` (limite de ${previa.limite} por aviso)` : ""}.</p>
              {previa.amostra.length > 0 && <p className="text-gray-400">Exemplo: {previa.amostra.map((a) => `${a.nome || "—"} (${a.telefone})`).join(", ")}</p>}
              <p className="text-gray-300 whitespace-pre-wrap bg-[#0d1117] rounded p-2">{previa.mensagem_exemplo}</p>
              <button className={btnPrimario} disabled={busy || previa.total === 0} onClick={enviar}>Enviar aviso agora</button>
            </div>
          )}
          {msg && <p className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-300">Últimos avisos</h2>
          {lista.length === 0 && <p className="text-sm text-gray-500">Nenhum aviso enviado ainda.</p>}
          {lista.map((e) => {
            const [rot, cls] = STATUS[e.status] || [e.status, "bg-gray-800 text-gray-300"];
            const feitos = (e.enviados || 0) + (e.falhas || 0) + (e.ignorados || 0);
            return (
              <div key={e.id} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="text-white truncate">{e.nome} · {fmt(e.criado_em)}</p>
                  <p className="text-xs text-gray-400">{feitos}/{e.total} · {e.enviados} enviados · {e.falhas} falhas · {e.ignorados} ignorados</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{rot}</span>
                  {e.status === "em_andamento" && <button className={btnSecundario} onClick={() => acao(e.id, "pausar")}>Pausar</button>}
                  {e.status === "pausada" && <button className={btnSecundario} onClick={() => acao(e.id, "retomar")}>Retomar</button>}
                  {["rascunho", "em_andamento", "pausada"].includes(e.status) && <button className={btnSecundario} onClick={() => acao(e.id, "cancelar")}>Cancelar</button>}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </AdminLayout>
  );
}
