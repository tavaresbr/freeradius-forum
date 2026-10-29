import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

// Agradecimento depois da compra, pedido de avaliação (nota alta) e alerta de nota baixa. Desligado por padrão.
export default function PosCompra({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [pronto, setPronto] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const comTelefones = (c) => ({ ...c, alerta_nota_baixa: { ...c.alerta_nota_baixa, telefones: [...(c.alerta_nota_baixa.telefones || []), "", "", ""].slice(0, 3) } });

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/pos-compra", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg(comTelefones(d.pos_compra)); setPronto(d.pronto !== false);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, [campo]: valor })); };
  const setAlerta = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, alerta_nota_baixa: { ...c.alerta_nota_baixa, [campo]: valor } })); };
  const setTel = (i, v) => setAlerta("telefones", cfg.alerta_nota_baixa.telefones.map((t, j) => (j === i ? v : t)));

  const salvar = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false); setBusy(true);
    try {
      const corpo = { ...cfg, alerta_nota_baixa: { ...cfg.alerta_nota_baixa, telefones: cfg.alerta_nota_baixa.telefones.filter((t) => t.trim()) } };
      const res = await fetch("/api/atendimento/pos-compra", { method: "PUT", headers, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível salvar"); return; }
      setCfg(comTelefones(data.pos_compra)); setOk(true);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo="Pós-compra e avaliações" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 059 no servidor para poder ativar.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Agradecer por WhatsApp depois de cada compra
          </label>
          <p className="text-xs text-gray-500">Só para quem pagou no portal e tem telefone no cadastro. Quem pediu para não receber mensagens é ignorado. Compras antigas (mais de 3 dias) nunca são enviadas.</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-300">Enviar
              <input type="number" min={1} max={72} value={cfg.horas_apos} onChange={(e) => set("horas_apos", Number(e.target.value))} className={`${inputCls} !w-20 mx-2 inline-block`} />
              hora(s) depois da compra
            </label>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Mensagem de agradecimento (<code>{"{{nome}}"}</code> <code>{"{{plano}}"}</code> <code>{"{{empresa}}"}</code>)</label>
            <textarea value={cfg.msg_agradecimento} onChange={(e) => set("msg_agradecimento", e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} />
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <p className="text-sm text-gray-200">Quando o cliente dá nota 4 ou 5 no atendimento</p>
            <p className="text-xs text-gray-500">Funciona junto com "Pedir nota de 1 a 5 ao resolver" (Resposta automática).</p>
            <input value={cfg.link_avaliacao} onChange={(e) => set("link_avaliacao", e.target.value)} placeholder="https://g.page/r/... (link de avaliação)" maxLength={500} className={inputCls} aria-label="Link de avaliação" />
            <textarea value={cfg.msg_avaliacao_alta} onChange={(e) => set("msg_avaliacao_alta", e.target.value)} rows={2} maxLength={1000} className={`${inputCls} resize-none`} aria-label="Mensagem de avaliação" />
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
              <input type="checkbox" checked={cfg.alerta_nota_baixa.ativo} onChange={(e) => setAlerta("ativo", e.target.checked)} /> Avisar a equipe quando a nota for 1 ou 2
            </label>
            {cfg.alerta_nota_baixa.telefones.map((t, i) => (
              <input key={i} value={t} onChange={(e) => setTel(i, e.target.value)} inputMode="tel" placeholder="93 99999-0000" className={inputCls} aria-label={`Telefone do alerta ${i + 1}`} />
            ))}
            <p className="text-xs text-yellow-500">Use um número que NÃO seja o do próprio WhatsApp conectado.</p>
          </div>
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
