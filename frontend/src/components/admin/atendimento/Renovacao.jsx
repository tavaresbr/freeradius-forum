import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

const rotuloDia = (d) => (d === 0 ? "No dia do vencimento" : `${d} dia${d > 1 ? "s" : ""} depois`);

// Lembrete por WhatsApp para quem comprou no portal e o acesso venceu, com link dos planos (e cupom opcional).
export default function Renovacao({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [permitidos, setPermitidos] = useState([0, 1, 2, 3, 5, 7, 10, 14, 30]);
  const [pronto, setPronto] = useState(true);
  const [rel, setRel] = useState(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/renovacao", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg(d.renovacao); setPermitidos(d.dias_permitidos || permitidos); setPronto(d.pronto !== false);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    fetch("/api/atendimento/renovacao/relatorio?dias=30", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && d && setRel(d))
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, [campo]: valor })); };
  const alternarDia = (d) => {
    const tem = cfg.dias.includes(d);
    set("dias", tem ? cfg.dias.filter((x) => x !== d) : [...cfg.dias, d].sort((a, b) => a - b));
  };

  const salvar = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false); setBusy(true);
    try {
      const res = await fetch("/api/atendimento/renovacao", { method: "PUT", headers, body: JSON.stringify(cfg) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível salvar"); return; }
      setCfg(data.renovacao); setOk(true);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo="Renovação (compras do portal)" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 061 no servidor para poder ativar.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Lembrar por WhatsApp quem comprou e o acesso venceu
          </label>
          <p className="text-xs text-gray-500">Só para quem pagou no portal e tem telefone no cadastro, e só se não comprou de novo. Quem pediu para não receber mensagens é ignorado, no máximo 1 lembrete por telefone a cada 20 h. O pagamento acontece no portal (PIX ou cartão). Compras que venceram há mais de 2 dias da data escolhida nunca são lembradas.</p>
          <div>
            <p className="text-sm text-gray-300 mb-1">Quando lembrar (até 3)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {permitidos.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={cfg.dias.includes(d)} onChange={() => alternarDia(d)} /> {rotuloDia(d)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Mensagem (<code>{"{{nome}}"}</code> <code>{"{{plano}}"}</code> <code>{"{{empresa}}"}</code> e obrigatório <code>{"{{link}}"}</code>)</label>
            <textarea value={cfg.template} onChange={(e) => set("template", e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Cupom no link (opcional)</label>
            <input value={cfg.cupom} onChange={(e) => set("cupom", e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={32} placeholder="VOLTA10" className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">O cupom precisa existir em Marketing &gt; Cupons. O cliente o vê já aplicado na tela de pagamento.</p>
          </div>
          {rel && (
            <div className="border-t border-gray-800 pt-3 text-sm text-gray-300">
              <p className="mb-1">Últimos 30 dias: <b>{rel.enviadas}</b> lembretes enviados, <b>{rel.convertidas}</b> voltaram a comprar em até 7 dias ({rel.taxa}%).</p>
              {rel.por_etapa.length > 0 && (
                <ul className="text-xs text-gray-400 space-y-0.5">
                  {rel.por_etapa.map((e) => <li key={e.etapa}>{rotuloDia(e.etapa)}: {e.enviadas} enviados, {e.convertidas} compras</li>)}
                </ul>
              )}
            </div>
          )}
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
