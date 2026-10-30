import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import GerenciarEtiquetas from "./GerenciarEtiquetas";

const inputCls = "px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm min-w-0";
const fmt = (d) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");

// Aba Contatos: conversas + clientes com telefone numa lista so. Sem CPF; ações: conversar, etiquetar, não perturbe.
export default function Contatos({ headers }) {
  const { empresaSlug } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [soOptout, setSoOptout] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState({ contatos: [], tem_mais: false });
  const [etiquetas, setEtiquetas] = useState([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [modal, setModal] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setBusca(q); setPagina(1); }, 500); return () => clearTimeout(t); }, [q]);

  const carregarEtiquetas = useCallback(async () => {
    try { const r = await fetch("/api/atendimento/etiquetas", { headers }); if (r.ok) setEtiquetas((await r.json()).etiquetas || []); } catch { /* sem etiquetas */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { carregarEtiquetas(); }, [carregarEtiquetas]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    const p = new URLSearchParams({ pagina: String(pagina) });
    if (busca) p.set("q", busca);
    if (origem) p.set("origem", origem);
    if (etiqueta) p.set("etiqueta", etiqueta);
    if (soOptout) p.set("optout", "1");
    try {
      const r = await fetch(`/api/atendimento/contatos?${p}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
      setDados(d);
    } catch { setErro("Erro de conexão"); }
    finally { setCarregando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, busca, origem, etiqueta, soOptout]);
  useEffect(() => { carregar(); }, [carregar]);

  const conversar = async (c) => {
    setErro("");
    if (c.conversa_id) { navigate(`/admin/${empresaSlug}/atendimento/conversas?conversa=${c.conversa_id}`); return; }
    try {
      const r = await fetch("/api/atendimento/conversas", { method: "POST", headers, body: JSON.stringify({ telefone: c.telefone, nome: c.nome }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error || "Não foi possível abrir a conversa"); return; }
      navigate(`/admin/${empresaSlug}/atendimento/conversas?conversa=${d.id}`);
    } catch { setErro("Erro de conexão"); }
  };

  const alternarOptout = async (c) => {
    setErro("");
    try {
      const r = await fetch(`/api/leads/${c.lead_id}`, { method: "PUT", headers, body: JSON.stringify({ whatsapp_optout: !c.optout }) });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).error || "Não foi possível alterar"); return; }
      carregar();
    } catch { setErro("Erro de conexão"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome ou telefone" className={`${inputCls} flex-1 min-w-[12rem]`} aria-label="Buscar contato" />
        <select value={origem} onChange={(e) => { setOrigem(e.target.value); setPagina(1); }} className={inputCls} aria-label="Origem">
          <option value="">Todos</option>
          <option value="conversas">Com conversa</option>
          <option value="sem_conversa">Só cadastro (sem conversa)</option>
        </select>
        {etiquetas.length > 0 && (
          <select value={etiqueta} onChange={(e) => { setEtiqueta(e.target.value); setPagina(1); }} className={inputCls} aria-label="Etiqueta">
            <option value="">Todas as etiquetas</option>
            {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={soOptout} onChange={(e) => { setSoOptout(e.target.checked); setPagina(1); }} /> Só quem pediu para sair</label>
        <button onClick={() => setModal(true)} className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">Etiquetas</button>
      </div>
      {erro && <p className="text-sm text-red-400">{erro} <button onClick={carregar} className="underline cursor-pointer">Tentar de novo</button></p>}
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-gray-400 border-b border-gray-800">
            <tr><th className="p-3">Nome</th><th className="p-3">Telefone</th><th className="p-3">Etiquetas</th><th className="p-3">Última atividade</th><th className="p-3">Situação</th><th className="p-3">Ações</th></tr>
          </thead>
          <tbody className="text-gray-200">
            {!carregando && dados.contatos.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">Nenhum contato encontrado.</td></tr>}
            {dados.contatos.map((c) => (
              <tr key={`${c.origem}-${c.conversa_id || c.lead_id}`} className="border-b border-gray-800/60">
                <td className="p-3">{c.nome || "Sem nome"}</td>
                <td className="p-3 font-mono text-xs">{c.telefone || "-"}</td>
                <td className="p-3">{c.etiquetas.map((e) => <span key={e.id} style={{ backgroundColor: e.cor }} className="inline-block text-xs text-white px-2 py-0.5 rounded-full mr-1">{e.nome}</span>)}</td>
                <td className="p-3">{fmt(c.atividade)}</td>
                <td className="p-3">
                  {c.nao_lidas > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 mr-1">{c.nao_lidas} não lida(s)</span>}
                  {c.optout && <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300">Não perturbe</span>}
                  {!c.nao_lidas && !c.optout && <span className="text-xs text-gray-500">{c.origem === "lead" ? "Só cadastro" : c.status_conversa === "resolvida" ? "Resolvida" : "Aberta"}</span>}
                </td>
                <td className="p-3 whitespace-nowrap">
                  <button onClick={() => conversar(c)} disabled={!c.telefone || c.optout} className="text-blue-400 hover:text-blue-300 mr-3 disabled:opacity-40 cursor-pointer">Conversar</button>
                  {c.lead_id && <button onClick={() => alternarOptout(c)} className="text-gray-400 hover:text-gray-200 cursor-pointer">{c.optout ? "Voltar a receber" : "Não perturbe"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="px-3 py-1 border border-gray-700 rounded disabled:opacity-40 cursor-pointer">Anterior</button>
        <span>Página {pagina}</span>
        <button disabled={!dados.tem_mais} onClick={() => setPagina((p) => p + 1)} className="px-3 py-1 border border-gray-700 rounded disabled:opacity-40 cursor-pointer">Próxima</button>
      </div>
      {modal && <GerenciarEtiquetas headers={headers} etiquetas={etiquetas} onFechar={() => setModal(false)} onMudou={async () => { await carregarEtiquetas(); carregar(); }} />}
    </div>
  );
}
