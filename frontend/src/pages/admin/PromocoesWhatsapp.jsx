import React, { useState, useEffect, useCallback, useRef } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const inputCls =
  "w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 text-sm";
const btnPrimario = "bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer";
const btnSecundario = "border border-gray-700 text-gray-300 px-3 py-2 rounded text-sm hover:bg-[#252b3b] disabled:opacity-50 cursor-pointer";

const STATUS_ROTULO = {
  rascunho: ["Rascunho", "bg-gray-800 text-gray-300"],
  em_andamento: ["Enviando", "bg-blue-900/40 text-blue-300"],
  pausada: ["Pausada", "bg-yellow-900/40 text-yellow-300"],
  concluida: ["Concluída", "bg-green-900/40 text-green-300"],
  cancelada: ["Cancelada", "bg-red-900/40 text-red-300"],
};
const ORIGENS = [
  ["lgpd", "Portal LGPD"],
  ["portal_lead", "Portal Lead"],
  ["portal_passivo", "Lead passivo"],
  ["portal_planos", "Portal de planos"],
  ["portal", "Portal (outros)"],
  ["manual", "Cadastro manual"],
  ["importacao", "Importados"],
];
const STATUS_LEAD = [["novo", "Novo"], ["contactado", "Contactado"], ["convertido", "Convertido"]];
const MENSAGEM_PADRAO = "Olá, {{nome}}! Temos uma promoção especial para você. Responda esta mensagem para saber mais.";
const FILTROS_VAZIOS = { origens: [], status: [], lgpd: "todos", q: "", inativo: "" };

const fmt = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "-");

function Selo({ status }) {
  const [rotulo, cls] = STATUS_ROTULO[status] || [status, "bg-gray-800 text-gray-300"];
  return <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{rotulo}</span>;
}

function Barra({ envio }) {
  const feitos = (envio.enviados || 0) + (envio.falhas || 0) + (envio.ignorados || 0);
  const pct = envio.total ? Math.min(100, Math.round((feitos / envio.total) * 100)) : 0;
  return (
    <div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {feitos} de {envio.total} ({pct}%) · {envio.enviados} enviadas · {envio.falhas} com erro · {envio.ignorados} ignoradas
      </p>
    </div>
  );
}

export default function PromocoesWhatsapp() {
  const token = localStorage.getItem("admin_token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tela, setTela] = useState("lista"); // lista | nova | detalhe
  const [detalhe, setDetalhe] = useState(null);
  const [msg, setMsg] = useState(null); // { tipo: 'erro' | 'ok', texto }

  // formulario da nova promocao
  const [nome, setNome] = useState("");
  const [mensagem, setMensagem] = useState(MENSAGEM_PADRAO);
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [previa, setPrevia] = useState(null);
  const [telTeste, setTelTeste] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const chamar = useCallback(async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro na requisição");
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const carregarLista = useCallback(async () => {
    try {
      const d = await chamar("/api/promocoes-whatsapp");
      setLista(d.data || []);
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    } finally {
      setLoading(false);
    }
  }, [chamar]);

  const carregarDetalhe = useCallback(async (id) => {
    try {
      const d = await chamar(`/api/promocoes-whatsapp/${id}`);
      setDetalhe(d.data);
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    }
  }, [chamar]);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  // Atualiza o progresso a cada 5 s enquanto a promocao esta sendo enviada
  const detalheRef = useRef(null);
  detalheRef.current = detalhe;
  useEffect(() => {
    if (tela !== "detalhe" || !detalhe || detalhe.status !== "em_andamento") return undefined;
    const t = setInterval(() => carregarDetalhe(detalheRef.current.id), 5000);
    return () => clearInterval(t);
  }, [tela, detalhe, carregarDetalhe]);

  const corpoFiltros = () => ({
    origens: filtros.origens,
    status: filtros.status,
    q: filtros.q,
    ...(Number(filtros.inativo) >= 1 ? { inativo_dias: Number(filtros.inativo) } : {}),
    ...(filtros.lgpd === "sim" ? { lgpd_aceite: true } : filtros.lgpd === "nao" ? { lgpd_aceite: false } : {}),
  });

  const alternar = (campo, valor) =>
    setFiltros((f) => ({ ...f, [campo]: f[campo].includes(valor) ? f[campo].filter((x) => x !== valor) : [...f[campo], valor] }));

  const mudouAlgo = () => setPrevia(null); // qualquer mudanca invalida a previa

  const calcularPrevia = async () => {
    setOcupado(true); setMsg(null);
    try {
      const d = await chamar("/api/promocoes-whatsapp/previa", {
        method: "POST",
        body: JSON.stringify({ mensagem, filtros: corpoFiltros() }),
      });
      setPrevia(d.data);
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    } finally { setOcupado(false); }
  };

  const enviarTeste = async () => {
    setOcupado(true); setMsg(null);
    try {
      await chamar("/api/promocoes-whatsapp/teste", { method: "POST", body: JSON.stringify({ mensagem, telefone: telTeste }) });
      setMsg({ tipo: "ok", texto: "Mensagem de teste enviada." });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    } finally { setOcupado(false); }
  };

  const criarEIniciar = async () => {
    if (!previa) return;
    if (!window.confirm(`Enviar esta promoção para ${previa.total} contato(s)? As mensagens saem aos poucos, com intervalo entre elas.`)) return;
    setOcupado(true); setMsg(null);
    try {
      const c = await chamar("/api/promocoes-whatsapp", {
        method: "POST",
        body: JSON.stringify({ nome, mensagem, filtros: corpoFiltros() }),
      });
      try {
        await chamar(`/api/promocoes-whatsapp/${c.data.id}/iniciar`, { method: "POST" });
      } catch (e) {
        // criada mas nao iniciada (ex.: WhatsApp desconectado): fica como rascunho
        setMsg({ tipo: "erro", texto: `Promoção criada como rascunho, mas não iniciou: ${e.message}` });
      }
      await carregarLista();
      await carregarDetalhe(c.data.id);
      setTela("detalhe");
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    } finally { setOcupado(false); }
  };

  const acao = async (id, nomeAcao) => {
    setOcupado(true); setMsg(null);
    try {
      await chamar(`/api/promocoes-whatsapp/${id}/${nomeAcao}`, { method: "POST" });
      await carregarDetalhe(id);
      carregarLista();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message });
    } finally { setOcupado(false); }
  };

  const abrirNova = () => {
    setNome(""); setMensagem(MENSAGEM_PADRAO); setFiltros(FILTROS_VAZIOS); setPrevia(null); setMsg(null); setTela("nova");
  };
  const abrirDetalhe = async (id) => { setMsg(null); await carregarDetalhe(id); setTela("detalhe"); };
  const voltar = () => { setTela("lista"); setDetalhe(null); setMsg(null); carregarLista(); };

  const aviso = msg && (
    <div className={`mb-4 p-3 rounded text-sm border ${msg.tipo === "erro" ? "bg-red-900/20 border-red-800 text-red-300" : "bg-green-900/20 border-green-800 text-green-300"}`}>
      {msg.texto}
    </div>
  );

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">Promoções WhatsApp</h1>
        {tela === "lista" ? (
          <button onClick={abrirNova} className={btnPrimario}>+ Nova promoção</button>
        ) : (
          <button onClick={voltar} className={btnSecundario}>← Voltar</button>
        )}
      </div>
      {aviso}

      {tela === "lista" && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-4">
            Envie promoções por WhatsApp para os contatos cadastrados. As mensagens saem aos poucos (uma a cada 8–20 segundos) para proteger o seu número.
            Quem responder <strong>SAIR</strong> deve ser marcado como "não quer promoções" na tela Clientes.
          </p>
          {loading ? (
            <p className="text-gray-400">Carregando...</p>
          ) : lista.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhuma promoção ainda.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500 border-b border-gray-800">
                <tr><th className="p-2">Promoção</th><th className="p-2">Status</th><th className="p-2">Progresso</th><th className="p-2">Criada em</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800 hover:bg-[#151821]">
                    <td className="p-2 text-white font-semibold">{e.nome}</td>
                    <td className="p-2"><Selo status={e.status} /></td>
                    <td className="p-2 text-gray-300">{(e.enviados || 0)}/{e.total}</td>
                    <td className="p-2 text-gray-400 text-xs">{fmt(e.criado_em)}</td>
                    <td className="p-2"><button onClick={() => abrirDetalhe(e.id)} className="text-blue-400 hover:text-blue-300 text-xs cursor-pointer">Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tela === "nova" && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 space-y-5 max-w-3xl">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome da promoção (só para você)</label>
            <input className={inputCls} maxLength={150} value={nome} onChange={(e) => { setNome(e.target.value); }} placeholder="Ex.: Black Friday 2026" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mensagem (use {"{{nome}}"} para o primeiro nome do cliente)</label>
            <textarea aria-label="Mensagem" className={inputCls} rows={5} maxLength={1000} value={mensagem} onChange={(e) => { setMensagem(e.target.value); mudouAlgo(); }} />
            <p className="text-xs text-gray-500 mt-1">{mensagem.length}/1000 · O aviso "Para não receber mais mensagens, responda SAIR." é adicionado automaticamente no final.</p>
          </div>

          <fieldset className="border border-gray-800 rounded p-3">
            <legend className="text-xs text-gray-400 px-1">Quem recebe (vazio = todos os contatos com telefone)</legend>
            <p className="text-xs text-gray-500 mb-2">Origem do cadastro</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {ORIGENS.map(([v, r]) => (
                <label key={v} className={`text-xs px-3 py-1 rounded-full border cursor-pointer ${filtros.origens.includes(v) ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300"}`}>
                  <input type="checkbox" className="hidden" checked={filtros.origens.includes(v)} onChange={() => { alternar("origens", v); mudouAlgo(); }} />{r}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-2">Situação do contato</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {STATUS_LEAD.map(([v, r]) => (
                <label key={v} className={`text-xs px-3 py-1 rounded-full border cursor-pointer ${filtros.status.includes(v) ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300"}`}>
                  <input type="checkbox" className="hidden" checked={filtros.status.includes(v)} onChange={() => { alternar("status", v); mudouAlgo(); }} />{r}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Aceitou o termo LGPD</label>
                <select aria-label="Aceitou o termo LGPD" className={inputCls} value={filtros.lgpd} onChange={(e) => { setFiltros((f) => ({ ...f, lgpd: e.target.value })); mudouAlgo(); }}>
                  <option value="todos">Tanto faz</option>
                  <option value="sim">Só quem aceitou</option>
                  <option value="nao">Só quem não aceitou</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Buscar (nome, e-mail ou telefone)</label>
                <input aria-label="Buscar contato" className={inputCls} value={filtros.q} onChange={(e) => { setFiltros((f) => ({ ...f, q: e.target.value })); mudouAlgo(); }} />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Reativação: sem conectar há (dias)</label>
              <input aria-label="Sem conectar há N dias" type="number" min={1} max={3650} placeholder="ex.: 30" className={`${inputCls} !w-32`} value={filtros.inativo} onChange={(e) => { setFiltros((f) => ({ ...f, inativo: e.target.value })); mudouAlgo(); }} />
              <p className="text-xs text-gray-500 mt-1">Só quem se cadastrou há mais de N dias, tem o aparelho (MAC) registrado e não conectou nesse período.</p>
            </div>
            <p className="text-xs text-gray-500 mt-3">Quem foi marcado como "não quer promoções" e contatos descartados nunca recebem.</p>
          </fieldset>

          <div className="flex flex-wrap gap-2 items-end">
            <button onClick={calcularPrevia} disabled={ocupado || !mensagem.trim()} className={btnSecundario}>Ver prévia e total</button>
            <div className="flex gap-2 items-end ml-auto">
              <input className={`${inputCls} w-44`} placeholder="Telefone de teste" value={telTeste} onChange={(e) => setTelTeste(e.target.value)} />
              <button onClick={enviarTeste} disabled={ocupado || !telTeste.trim() || !mensagem.trim()} className={btnSecundario}>Enviar teste</button>
            </div>
          </div>

          {previa && (
            <div className="bg-[#0d1117] border border-gray-800 rounded p-4 text-sm">
              <p className="text-white font-semibold mb-1">{previa.total} contato(s) vão receber</p>
              <p className="text-xs text-gray-500 mb-3">
                {previa.invalidos} com telefone inválido e {previa.duplicados} repetido(s) ficaram de fora.
                {previa.excedeu && ` Limite de ${previa.limite} por promoção: os demais ficam de fora.`}
              </p>
              <p className="text-xs text-gray-500 mb-1">Exemplo da mensagem:</p>
              <pre className="whitespace-pre-wrap text-gray-200 bg-[#1a1d27] rounded p-3 text-xs">{previa.mensagem_exemplo}</pre>
              {previa.amostra.length > 0 && (
                <p className="text-xs text-gray-500 mt-3">Primeiros: {previa.amostra.map((a) => `${a.nome || "sem nome"} (${a.telefone})`).join(", ")}</p>
              )}
              <div className="mt-4">
                <button onClick={criarEIniciar} disabled={ocupado || !nome.trim() || previa.total === 0} className={btnPrimario}>
                  {ocupado ? "Aguarde..." : `Enviar para ${previa.total} contato(s)`}
                </button>
                {!nome.trim() && <span className="text-xs text-yellow-400 ml-3">Dê um nome à promoção.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {tela === "detalhe" && detalhe && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 space-y-4 max-w-3xl">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white flex-1">{detalhe.nome}</h2>
            <Selo status={detalhe.status} />
          </div>
          <Barra envio={detalhe} />
          <pre className="whitespace-pre-wrap text-gray-300 bg-[#0d1117] rounded p-3 text-xs">{detalhe.mensagem}</pre>
          <p className="text-xs text-gray-500">Criada em {fmt(detalhe.criado_em)} · Início {fmt(detalhe.iniciado_em)} · Fim {fmt(detalhe.concluido_em)}</p>
          {detalhe.status === "pausada" && (
            <p className="text-xs text-yellow-400">Pausada. Se foi por WhatsApp desconectado, reconecte na tela WhatsApp e clique em Retomar.</p>
          )}
          <div className="flex gap-2">
            {detalhe.status === "rascunho" && <button className={btnPrimario} disabled={ocupado} onClick={() => acao(detalhe.id, "iniciar")}>Iniciar</button>}
            {detalhe.status === "em_andamento" && <button className={btnSecundario} disabled={ocupado} onClick={() => acao(detalhe.id, "pausar")}>Pausar</button>}
            {detalhe.status === "pausada" && <button className={btnPrimario} disabled={ocupado} onClick={() => acao(detalhe.id, "retomar")}>Retomar</button>}
            {["rascunho", "em_andamento", "pausada"].includes(detalhe.status) && (
              <button className="bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-500 disabled:opacity-50 cursor-pointer" disabled={ocupado}
                onClick={() => { if (window.confirm("Cancelar esta promoção? As mensagens que faltam não serão enviadas.")) acao(detalhe.id, "cancelar"); }}>
                Cancelar
              </button>
            )}
          </div>
          {detalhe.erros?.length > 0 && (
            <div>
              <p className="text-sm text-white mb-2">Últimos erros</p>
              <ul className="text-xs text-gray-400 space-y-1">
                {detalhe.erros.map((e, i) => <li key={i}>{e.nome || "sem nome"} ({e.telefone}): {e.erro_msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
