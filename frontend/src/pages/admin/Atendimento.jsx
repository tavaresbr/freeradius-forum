import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import MidiaMensagem from "../../components/admin/atendimento/MidiaMensagem";

const FILTROS = [
  ["aberta", "Abertas"],
  ["nao_lidas", "Não lidas"],
  ["resolvida", "Resolvidas"],
];

const MAX_ARQUIVO = 16 * 1024 * 1024;
const EXT_ACEITAS = ["jpg", "jpeg", "png", "webp", "gif", "mp4", "ogg", "mp3", "m4a", "aac", "wav", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "zip"];
const tamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const hora = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

const formatarTelefone = (t) => {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return t || "";
};

const titulo = (c) => c.nome || formatarTelefone(c.telefone) || "Contato";

function Ticks({ status }) {
  if (status === "enviando") return <span className="text-white/70">…</span>;
  if (status === "erro") return <span className="text-red-200 font-bold">!</span>;
  if (status === "enviada") return <span className="text-white/70">✓</span>;
  return <span className={status === "lida" ? "text-sky-200 font-bold" : "text-white/70"}>✓✓</span>;
}

export default function Atendimento() {
  const { empresaSlug } = useParams();
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const [filtro, setFiltro] = useState("aberta");
  const [busca, setBusca] = useState("");
  const [conversas, setConversas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [selecionadaId, setSelecionadaId] = useState(null);
  const [conversa, setConversa] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const arquivoRef = useRef(null);
  const [erroEnvio, setErroEnvio] = useState("");
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEdit, setNomeEdit] = useState("");
  const [webhook, setWebhook] = useState(null); // null = desconhecido, true/false
  const [ativando, setAtivando] = useState(false);
  const [msgWebhook, setMsgWebhook] = useState("");

  const fimRef = useRef(null);
  const listaRef = useRef(null);
  const noFimRef = useRef(true);
  const selRef = useRef(null);
  selRef.current = selecionadaId;

  const carregarConversas = useCallback(async () => {
    const params = new URLSearchParams();
    if (filtro === "nao_lidas") { params.set("status", "aberta"); params.set("nao_lidas", "1"); }
    else params.set("status", filtro);
    if (busca.trim()) params.set("q", busca.trim());
    try {
      const res = await fetch(`/api/atendimento/conversas?${params}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroLista(data.message || data.error || "Erro ao carregar conversas"); return; }
      setErroLista("");
      setConversas(data.conversas || []);
    } catch {
      setErroLista("Erro de conexão");
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, busca, token]);

  const carregarMensagens = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/atendimento/conversas/${id}/mensagens?limite=60`, { headers });
      if (!res.ok || selRef.current !== id) return;
      const data = await res.json();
      setConversa(data.conversa);
      // mantem mensagens mais antigas ja carregadas e troca as recentes (status de entrega muda)
      setMensagens((ant) => {
        const novas = data.mensagens || [];
        const primeiro = novas.length ? novas[0].id : Infinity;
        return [...ant.filter((m) => m.id < primeiro), ...novas];
      });
    } catch { /* tenta de novo no proximo ciclo */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // lista: recarrega ao mudar filtro/busca e a cada 3 s com a aba visivel
  useEffect(() => {
    setCarregando(true);
    carregarConversas();
    const t = setInterval(() => { if (!document.hidden) carregarConversas(); }, 3000);
    return () => clearInterval(t);
  }, [carregarConversas]);

  // conversa aberta: troca, marca como lida e atualiza a cada 3 s
  useEffect(() => {
    setMensagens([]);
    setConversa(null);
    setErroEnvio("");
    setArquivo(null);
    setEditandoNome(false);
    noFimRef.current = true;
    if (!selecionadaId) return;
    carregarMensagens(selecionadaId);
    fetch(`/api/atendimento/conversas/${selecionadaId}/lida`, { method: "POST", headers }).catch(() => {});
    const t = setInterval(() => { if (!document.hidden) carregarMensagens(selecionadaId); }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadaId]);

  // mensagem nova com a conversa aberta continua lida
  useEffect(() => {
    if (!selecionadaId) return;
    const c = conversas.find((x) => x.id === selecionadaId);
    if (c?.nao_lidas > 0) fetch(`/api/atendimento/conversas/${selecionadaId}/lida`, { method: "POST", headers }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversas, selecionadaId]);

  useEffect(() => {
    if (noFimRef.current) fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  // o webhook so e' consultado por quem tem acesso a configuracao do WhatsApp (senao ignora)
  useEffect(() => {
    fetch("/api/whatsapp/webhook/status", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWebhook(d ? !!d.ativo : null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ativarWebhook = async () => {
    setAtivando(true);
    setMsgWebhook("");
    try {
      const res = await fetch("/api/whatsapp/webhook/ativar", { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsgWebhook(data.error || "Não foi possível ativar"); return; }
      setWebhook(true);
    } catch {
      setMsgWebhook("Erro de conexão");
    } finally {
      setAtivando(false);
    }
  };

  const aoRolar = () => {
    const el = listaRef.current;
    if (el) noFimRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const escolherArquivo = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!EXT_ACEITAS.includes(ext)) { setErroEnvio("Tipo de arquivo não permitido. Use imagem, vídeo MP4, áudio, PDF, Office, TXT, CSV ou ZIP."); return; }
    if (f.size > MAX_ARQUIVO) { setErroEnvio("Arquivo muito grande (máximo 16 MB)."); return; }
    setErroEnvio("");
    setArquivo(f);
  };

  const enviar = async () => {
    const t = texto.trim();
    if ((!t && !arquivo) || enviando || !selecionadaId) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      let res;
      if (arquivo) {
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        fd.append("legenda", t);
        res = await fetch(`/api/atendimento/conversas/${selecionadaId}/midia`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      } else {
        res = await fetch(`/api/atendimento/conversas/${selecionadaId}/mensagens`, { method: "POST", headers, body: JSON.stringify({ texto: t }) });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErroEnvio(data.error || "Erro ao enviar");
      else { setTexto(""); setArquivo(null); }
      noFimRef.current = true;
      await carregarMensagens(selecionadaId);
      carregarConversas();
    } catch {
      setErroEnvio("Erro de conexão");
    } finally {
      setEnviando(false);
    }
  };

  const alterar = async (campos) => {
    if (!selecionadaId) return;
    await fetch(`/api/atendimento/conversas/${selecionadaId}`, { method: "PUT", headers, body: JSON.stringify(campos) });
    await Promise.all([carregarMensagens(selecionadaId), carregarConversas()]);
  };

  const salvarNome = async () => {
    await alterar({ nome: nomeEdit });
    setEditandoNome(false);
  };

  const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";

  return (
    <AdminLayout>
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold text-white">WhatsApp</h1>
          <Link to={`/admin/${empresaSlug}/whatsapp`} className="text-sm text-blue-400 hover:text-blue-300">Conexão e histórico de envios</Link>
        </div>

        {webhook === false && (
          <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-yellow-300">O recebimento de mensagens ainda não está ativo nesta instância. Ative para as respostas dos clientes aparecerem aqui.</p>
            <div className="flex items-center gap-3">
              {msgWebhook && <span className="text-xs text-red-400">{msgWebhook}</span>}
              <button onClick={ativarWebhook} disabled={ativando} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm disabled:opacity-50 cursor-pointer">
                {ativando ? "Ativando..." : "Ativar recebimento"}
              </button>
            </div>
          </div>
        )}

        <div className="flex bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden h-[72vh] min-h-[420px]">
          {/* Lista */}
          <aside className={`${selecionadaId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 md:shrink-0 border-r border-gray-800 min-w-0`}>
            <div className="p-3 space-y-2 border-b border-gray-800">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou telefone" className={inputCls} />
              <div className="flex gap-1 flex-wrap">
                {FILTROS.map(([k, rot]) => (
                  <button
                    key={k}
                    onClick={() => setFiltro(k)}
                    className={`px-3 py-1 rounded-full text-xs cursor-pointer ${filtro === k ? "bg-blue-900/30 text-blue-400 border border-blue-800/50" : "bg-[#0f111a] text-gray-400 border border-gray-800 hover:bg-[#252b3b]"}`}
                  >
                    {rot}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {erroLista && <p className="p-4 text-sm text-red-400">{erroLista}</p>}
              {!erroLista && !carregando && conversas.length === 0 && (
                <p className="p-6 text-center text-sm text-gray-500">Nenhuma conversa {filtro === "resolvida" ? "resolvida" : filtro === "nao_lidas" ? "não lida" : "aberta"}.</p>
              )}
              {conversas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelecionadaId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-[#252b3b] cursor-pointer ${selecionadaId === c.id ? "bg-[#252b3b]" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${c.nao_lidas > 0 ? "font-semibold text-white" : "text-gray-200"}`}>{titulo(c)}</span>
                    <span className="text-xs text-gray-500 shrink-0">{hora(c.ultima_msg_em)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-gray-400 truncate">{c.ultima_msg_previa || ""}</span>
                    {c.nao_lidas > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-green-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">{c.nao_lidas}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Conversa */}
          <section className={`${selecionadaId ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0`}>
            {!selecionadaId ? (
              <div className="flex-1 flex items-center justify-center text-center p-6">
                <p className="text-gray-500 text-sm">Selecione uma conversa para responder.</p>
              </div>
            ) : (
              <>
                <header className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 flex-wrap">
                  <button onClick={() => setSelecionadaId(null)} className="md:hidden text-gray-400 hover:text-white cursor-pointer" aria-label="Voltar">←</button>
                  <div className="min-w-0 flex-1">
                    {editandoNome ? (
                      <div className="flex gap-2">
                        <input value={nomeEdit} onChange={(e) => setNomeEdit(e.target.value)} className={inputCls} maxLength={150} autoFocus />
                        <button onClick={salvarNome} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm cursor-pointer">Salvar</button>
                      </div>
                    ) : (
                      <p className="text-white font-medium truncate">
                        {conversa ? titulo(conversa) : "..."}
                        {conversa && (
                          <button onClick={() => { setNomeEdit(conversa.nome || ""); setEditandoNome(true); }} className="ml-2 text-xs text-blue-400 hover:text-blue-300 cursor-pointer">editar nome</button>
                        )}
                      </p>
                    )}
                    {conversa && (
                      <p className="text-xs text-gray-500 truncate">
                        {formatarTelefone(conversa.telefone) || "Sem número identificado"}
                        {conversa.lead_id && <> · <Link to={`/admin/${empresaSlug}/leads`} className="text-blue-400 hover:text-blue-300">cliente cadastrado</Link></>}
                      </p>
                    )}
                  </div>
                  {conversa && (
                    <button
                      onClick={() => alterar({ status: conversa.status === "aberta" ? "resolvida" : "aberta" })}
                      className="px-3 py-1.5 bg-[#0f111a] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] text-sm cursor-pointer"
                    >
                      {conversa.status === "aberta" ? "Resolver" : "Reabrir"}
                    </button>
                  )}
                </header>

                <div ref={listaRef} onScroll={aoRolar} className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#0f111a]">
                  {mensagens.map((m) => (
                    <div key={m.id} className={`flex ${m.direcao === "in" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${m.direcao === "in" ? "bg-[#252b3b] text-gray-100" : "bg-green-700/80 text-white"}`}>
                        {m.tem_midia
                          ? <div className="mb-1"><MidiaMensagem mensagem={m} /></div>
                          : m.tipo !== "texto" && <p className="text-xs opacity-70 mb-0.5">{{ imagem: "📷 Imagem", audio: "🎤 Áudio", video: "🎥 Vídeo", documento: "📄 Documento", outro: "Mensagem não suportada" }[m.tipo]}</p>}
                        {m.texto}
                        <div className="flex items-center justify-end gap-1 mt-1 text-[11px] opacity-80">
                          <span>{hora(m.criado_em)}</span>
                          {m.direcao === "out" && <Ticks status={m.status} />}
                        </div>
                        {m.status === "erro" && <p className="text-xs text-red-200 mt-1">{m.erro || "Falha no envio"}</p>}
                      </div>
                    </div>
                  ))}
                  <div ref={fimRef} />
                </div>

                <footer className="p-3 border-t border-gray-800">
                  {erroEnvio && <p className="text-xs text-red-400 mb-2">{erroEnvio}</p>}
                  {arquivo && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-[#0f111a] border border-gray-800 text-sm text-gray-300">
                      <span>📎</span>
                      <span className="truncate flex-1 min-w-0">{arquivo.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">{tamanho(arquivo.size)}</span>
                      <button onClick={() => setArquivo(null)} className="text-gray-400 hover:text-red-400 cursor-pointer" aria-label="Remover arquivo">✕</button>
                    </div>
                  )}
                  <div className="flex gap-2 items-end">
                    <input ref={arquivoRef} type="file" onChange={escolherArquivo} className="hidden" accept={EXT_ACEITAS.map((x) => `.${x}`).join(",")} />
                    <button onClick={() => arquivoRef.current?.click()} disabled={enviando} className="px-3 py-2 bg-[#0f111a] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] text-sm cursor-pointer disabled:opacity-50" aria-label="Anexar arquivo" title="Anexar arquivo">📎</button>
                    <textarea
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                      rows={2}
                      maxLength={4000}
                      placeholder={arquivo ? "Legenda (opcional)" : "Digite a mensagem (Enter envia, Shift+Enter quebra a linha)"}
                      className={`${inputCls} resize-none`}
                    />
                    <button onClick={enviar} disabled={enviando || (!texto.trim() && !arquivo)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm disabled:opacity-50 cursor-pointer">
                      {enviando ? "..." : "Enviar"}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
