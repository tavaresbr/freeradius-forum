import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

const TIPOS = [
  ["saldo", "Mostrar o tempo restante"],
  ["planos", "Enviar o link dos planos"],
  ["atendente", "Chamar um atendente"],
  ["texto", "Responder um texto fixo"],
];
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Menu automatico (1, 2, 3...) antes do atendimento humano. Desligado por padrao.
export default function Chatbot({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [pronto, setPronto] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/chatbot", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg(d.chatbot); setPronto(d.pronto !== false);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, [campo]: valor })); };
  const setOpcao = (i, campo, valor) => { setOk(false); setCfg((c) => ({ ...c, opcoes: c.opcoes.map((o, j) => (j === i ? { ...o, [campo]: valor } : o)) })); };
  const addOpcao = () => {
    const usadas = new Set(cfg.opcoes.map((o) => o.tecla));
    const livre = TECLAS.find((t) => !usadas.has(t));
    if (!livre) return;
    set("opcoes", [...cfg.opcoes, { tecla: livre, rotulo: "", tipo: "texto", texto: "" }]);
  };
  const remover = (i) => set("opcoes", cfg.opcoes.filter((_, j) => j !== i));

  const salvar = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false); setBusy(true);
    try {
      const res = await fetch("/api/atendimento/chatbot", { method: "PUT", headers, body: JSON.stringify(cfg) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível salvar"); return; }
      setCfg(data.chatbot); setOk(true);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo="Chatbot de menu" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 058 no servidor para poder ativar.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Ativar o chatbot
          </label>
          <p className="text-xs text-gray-500">Na primeira mensagem do cliente (e a cada 12 h) manda o menu; o cliente responde com o número. Não responde se um atendente assumiu a conversa, se a equipe já respondeu nas últimas 12 h, nem para quem escreveu SAIR. Ao escolher "atendente" o robô para por 12 h.</p>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Mensagem do menu (<code>{"{{nome}}"}</code> = primeiro nome)</label>
            <textarea value={cfg.mensagem_menu} onChange={(e) => set("mensagem_menu", e.target.value)} rows={2} maxLength={600} className={`${inputCls} resize-none`} />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-gray-300">Opções do menu</p>
            {cfg.opcoes.map((o, i) => (
              <div key={i} className="border border-gray-800 rounded-lg p-2 space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={o.tecla} onChange={(e) => setOpcao(i, "tecla", e.target.value)} className={`${inputCls} !w-16`} aria-label={`Tecla da opção ${i + 1}`}>
                    {TECLAS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={o.rotulo} onChange={(e) => setOpcao(i, "rotulo", e.target.value)} maxLength={60} placeholder="Nome da opção" className={`${inputCls} flex-1 min-w-0`} aria-label={`Nome da opção ${i + 1}`} />
                  <button type="button" onClick={() => remover(i)} className="text-red-400 hover:text-red-300 text-sm cursor-pointer" aria-label={`Remover opção ${i + 1}`}>Remover</button>
                </div>
                <select value={o.tipo} onChange={(e) => setOpcao(i, "tipo", e.target.value)} className={inputCls} aria-label={`Ação da opção ${i + 1}`}>
                  {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
                {o.tipo === "texto" && <textarea value={o.texto} onChange={(e) => setOpcao(i, "texto", e.target.value)} rows={2} maxLength={500} placeholder="Texto da resposta" className={`${inputCls} resize-none`} aria-label={`Texto da opção ${i + 1}`} />}
              </div>
            ))}
            {cfg.opcoes.length < 9 && <button type="button" onClick={addOpcao} className={btnSecondary}>+ Adicionar opção</button>}
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Resposta ao chamar o atendente</label>
            <textarea value={cfg.msg_atendente} onChange={(e) => set("msg_atendente", e.target.value)} rows={2} maxLength={600} className={`${inputCls} resize-none`} />
          </div>
          <p className="text-xs text-yellow-500">Atenção: mensagens automáticas em excesso aumentam o risco de bloqueio do número pelo WhatsApp.</p>
          {erro && <p className="text-sm text-red-400">{erro}</p>}
          {ok && <p className="text-sm text-green-400">Salvo.</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Salvando..." : "Salvar"}</button>
            <button type="button" className={btnSecondary} onClick={onFechar}>Fechar</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
