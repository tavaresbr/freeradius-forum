import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

// Atendente automatico com IA (Claude). Desligado por padrao; usa a base de conhecimento da empresa e dados do sistema.
export default function IaAtendente({ headers, onFechar }) {
  const [dados, setDados] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msgTeste, setMsgTeste] = useState("");
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/ia-atendente", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setDados(d); setCfg(d.ia_atendente);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, [campo]: valor })); };
  const disponivel = dados && dados.chave_no_servidor && dados.recurso && dados.pronto;

  const salvar = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false); setBusy(true);
    try {
      const res = await fetch("/api/atendimento/ia-atendente", { method: "PUT", headers, body: JSON.stringify(cfg) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível salvar"); return; }
      setCfg(data.ia_atendente); setOk(true);
    } catch { setErro("Erro de conexão"); } finally { setBusy(false); }
  };

  const testar = async () => {
    setErro(""); setTeste(null); setTestando(true);
    try {
      const res = await fetch("/api/atendimento/ia-atendente/testar", { method: "POST", headers, body: JSON.stringify({ mensagem: msgTeste, config: cfg }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível testar"); return; }
      setTeste(data);
    } catch { setErro("Erro de conexão"); } finally { setTestando(false); }
  };

  const uso = dados?.uso;

  return (
    <Modal titulo="Atendente com IA" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!dados.recurso && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">O Atendente com IA não está incluído no seu plano. Veja os planos e adicionais em Assinatura.</p>}
          {dados.recurso && !dados.chave_no_servidor && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">A IA ainda não foi configurada neste servidor. Fale com o suporte.</p>}
          {dados.recurso && !dados.pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 077 no servidor para poder ativar.</p>}
          {uso && <p className="text-xs text-gray-400">Uso neste mês: <b className="text-gray-200">{uso.usadas}</b> {uso.limite == null ? "respostas (ilimitado)" : `de ${uso.limite} respostas`}. Quando o limite acaba, a conversa vai para a equipe.</p>}

          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Ativar o atendente com IA
          </label>
          <p className="text-xs text-gray-500">Responde sozinho às mensagens de texto dos clientes usando a base de conhecimento abaixo e os dados do sistema (tempo restante, último pagamento, link dos planos). Não faz pagamentos, descontos nem alterações de cadastro: nesses casos chama um atendente. Não responde se um atendente assumiu a conversa, se a equipe já respondeu nas últimas 12 h, nem para quem escreveu SAIR.</p>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Quando atuar</label>
            <select value={cfg.quando} onChange={(e) => set("quando", e.target.value)} className={inputCls}>
              <option value="fora_do_horario">Só fora do horário de atendimento (definido em Resposta automática)</option>
              <option value="sempre">Sempre</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Base de conhecimento ({cfg.base_conhecimento.length}/6000)</label>
            <textarea value={cfg.base_conhecimento} onChange={(e) => set("base_conhecimento", e.target.value)} rows={8} maxLength={6000} className={`${inputCls} resize-y`}
              placeholder={"Escreva o que a IA pode afirmar: planos e preços, como pagar, horários, regras, problemas comuns e soluções.\nExemplo: O plano de 1 hora custa R$ 5,00. Pagamento por PIX ou cartão no portal."} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Nome do assistente</label>
              <input value={cfg.nome_assistente} onChange={(e) => set("nome_assistente", e.target.value)} maxLength={40} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Respostas por conversa por hora</label>
              <input type="number" min={1} max={30} value={cfg.limite_por_conversa_hora} onChange={(e) => set("limite_por_conversa_hora", Number(e.target.value))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Tom de voz</label>
            <input value={cfg.tom} onChange={(e) => set("tom", e.target.value)} maxLength={200} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Apresentação (1ª resposta da conversa; <code>{"{{empresa}}"}</code>, <code>{"{{nome}}"}</code>)</label>
            <textarea value={cfg.msg_identificacao} onChange={(e) => set("msg_identificacao", e.target.value)} rows={2} maxLength={600} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Mensagem ao chamar um atendente</label>
            <textarea value={cfg.msg_transferir} onChange={(e) => set("msg_transferir", e.target.value)} rows={2} maxLength={600} className={`${inputCls} resize-none`} />
          </div>

          <div className="border border-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-sm text-gray-300">Testar (nada é enviado a clientes; usa dados de exemplo)</p>
            <div className="flex gap-2">
              <input value={msgTeste} onChange={(e) => setMsgTeste(e.target.value)} maxLength={500} placeholder="Ex.: quanto custa o plano de 1 hora?" className={`${inputCls} flex-1 min-w-0`} aria-label="Mensagem do cliente para teste" />
              <button type="button" onClick={testar} disabled={!disponivel || testando || !msgTeste.trim()} className={btnSecondary}>{testando ? "Testando..." : "Testar"}</button>
            </div>
            {teste && (
              <div className="text-sm bg-[#0f111a] border border-gray-800 rounded-lg p-2 space-y-1">
                {teste.resposta && <p className="text-gray-200 whitespace-pre-wrap">🤖 {teste.resposta}</p>}
                {teste.transferiu && <p className="text-yellow-300">Chamaria um atendente. Motivo: {teste.transferiu}</p>}
                {teste.ferramentas?.length > 0 && <p className="text-xs text-gray-500">Ferramentas usadas: {teste.ferramentas.join(", ")}</p>}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">Privacidade (LGPD): trechos da conversa são enviados à Anthropic para gerar a resposta, com CPF, telefone e e-mail removidos. O cliente é avisado de que fala com um assistente virtual.</p>
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
