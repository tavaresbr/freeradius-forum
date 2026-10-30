import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";
import SeletorModelo from "./SeletorModelo";

// Aviso "seu tempo esta acabando" (desligado por padrao): manda o link de planos antes de o acesso acabar.
export default function AvisoExpiracao({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [telefone, setTelefone] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/aviso-expiracao", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => { if (vivo) (r.ok ? setCfg(d.aviso) : setErro(d.error || "Não foi possível carregar")); })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(""); setCfg((c) => ({ ...c, [campo]: valor })); };

  const chamar = async (url, method, corpo, sucesso) => {
    setErro(""); setOk(""); setBusy(true);
    try {
      const res = await fetch(url, { method, headers, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível concluir"); return; }
      if (data.aviso) setCfg(data.aviso);
      setOk(sucesso);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  const salvar = (e) => { e.preventDefault(); chamar("/api/atendimento/aviso-expiracao", "PUT", cfg, "Salvo."); };
  const testar = () => chamar("/api/atendimento/aviso-expiracao/teste", "POST", { telefone, template: cfg.template, minutos: cfg.minutos }, "Teste enviado.");

  return (
    <Modal titulo="Aviso: seu tempo está acabando" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Avisar o cliente por WhatsApp antes do acesso acabar
          </label>
          <p className="text-xs text-gray-500">Só para clientes com CPF cadastrado e telefone no cadastro, conectados agora. Um aviso por liberação, nunca para quem pediu para não receber mensagens.</p>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Avisar quando faltarem (minutos)</label>
            <input type="number" min={5} max={60} value={cfg.minutos} onChange={(e) => set("minutos", Number(e.target.value))} className={`${inputCls} !w-28`} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Mensagem</label>
            <textarea value={cfg.template} onChange={(e) => set("template", e.target.value)} rows={4} maxLength={1000} className={`${inputCls} resize-none`} />
            <SeletorModelo headers={headers} categoria="cobranca" onEscolher={(t) => set("template", t.slice(0, 1000))} />
            <p className="text-xs text-gray-500 mt-1">Variáveis: <code>{"{{nome}}"}</code> <code>{"{{minutos}}"}</code> <code>{"{{link}}"}</code> <code>{"{{plano}}"}</code> <code>{"{{empresa}}"}</code></p>
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <label className="block text-sm text-gray-300">Enviar um teste para</label>
            <div className="flex gap-2 flex-wrap">
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" placeholder="93 99999-0000" className={`${inputCls} !w-48 min-w-0`} />
              <button type="button" onClick={testar} disabled={busy || !telefone.trim() || !cfg.template.trim()} className={btnSecondary}>Enviar teste</button>
            </div>
          </div>
          <p className="text-xs text-yellow-500">Atenção: avisos automáticos em excesso aumentam o risco de bloqueio do número pelo WhatsApp.</p>
          {erro && <p className="text-sm text-red-400">{erro}</p>}
          {ok && <p className="text-sm text-green-400">{ok}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Aguarde..." : "Salvar"}</button>
            <button type="button" className={btnSecondary} onClick={onFechar}>Fechar</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
