import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

// Avisa o proprietario por WhatsApp quando ha cliente esperando atendimento no chat (desligado por padrao).
export default function AlertaEspera({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [pronto, setPronto] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [teste, setTeste] = useState("");

  const completar = (a) => ({ ...a, telefones: [...a.telefones, "", "", ""].slice(0, 3) });

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/alerta-espera", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg(completar(d.alerta)); setPronto(d.pronto !== false);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(""); setCfg((c) => ({ ...c, [campo]: valor })); };
  const setTel = (i, v) => { setOk(""); setCfg((c) => ({ ...c, telefones: c.telefones.map((t, j) => (j === i ? v : t)) })); };

  const chamar = async (url, method, corpo, sucesso, aplicar) => {
    setErro(""); setOk(""); setBusy(true);
    try {
      const res = await fetch(url, { method, headers, body: JSON.stringify(corpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível concluir"); return; }
      if (aplicar) aplicar(data);
      setOk(sucesso);
    } catch { setErro("Erro de conexão"); } finally { setBusy(false); }
  };

  const salvar = (e) => {
    e.preventDefault();
    chamar("/api/atendimento/alerta-espera", "PUT", { ...cfg, minutos: Number(cfg.minutos), telefones: cfg.telefones.filter((t) => t.trim()) }, "Salvo.", (d) => setCfg(completar(d.alerta)));
  };

  return (
    <Modal titulo="Aviso de cliente esperando" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 079 no servidor para poder ativar.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Avisar por WhatsApp quando houver cliente esperando
          </label>
          <p className="text-xs text-gray-500">Quando um cliente fica sem resposta da equipe pelo tempo abaixo (ou foi passado para a equipe pelo robô e ninguém respondeu), o sistema manda <b>uma mensagem</b> com a lista de quem está esperando e o link do atendimento. Resposta automática ou da IA não conta como atendimento. Cada espera é avisada uma única vez.</p>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Avisar depois de (minutos sem resposta)</label>
            <input type="number" min={2} max={240} value={cfg.minutos} onChange={(e) => set("minutos", e.target.value)} className={`${inputCls} !w-28`} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={cfg.somente_horario} onChange={(e) => set("somente_horario", e.target.checked)} /> Só avisar dentro do horário de atendimento (definido em Resposta automática)
          </label>
          <div className="space-y-2">
            <p className="text-sm text-gray-300">Telefones que recebem o aviso (até 3, com DDD)</p>
            {cfg.telefones.map((t, i) => (
              <input key={i} value={t} onChange={(e) => setTel(i, e.target.value)} inputMode="tel" placeholder="(93) 99999-0000" className={inputCls} aria-label={`Telefone ${i + 1}`} />
            ))}
            <p className="text-xs text-yellow-500">Use um número diferente do WhatsApp conectado ao sistema (o aviso sai por ele).</p>
          </div>
          <div className="border border-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-sm text-gray-300">Enviar um aviso de teste</p>
            <div className="flex gap-2">
              <input value={teste} onChange={(e) => setTeste(e.target.value)} inputMode="tel" placeholder="Telefone" className={`${inputCls} flex-1 min-w-0`} aria-label="Telefone do teste" />
              <button type="button" disabled={busy || !teste.trim()} className={btnSecondary} onClick={() => chamar("/api/atendimento/alerta-espera/teste", "POST", { telefone: teste }, "Teste enviado.")}>Enviar teste</button>
            </div>
          </div>
          {erro && <p className="text-sm text-red-400">{erro}</p>}
          {ok && <p className="text-sm text-green-400">{ok}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Salvando..." : "Salvar"}</button>
            <button type="button" className={btnSecondary} onClick={onFechar}>Fechar</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
