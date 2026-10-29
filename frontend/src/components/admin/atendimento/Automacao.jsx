import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./Modal";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Resposta automatica: boas-vindas e mensagem fora do horario (desligada por padrao).
export default function Automacao({ headers, onFechar }) {
  const [cfg, setCfg] = useState(null);
  const [pronto, setPronto] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/atendimento/automacao", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg(d.automacao);
        setPronto(d.pronto !== false);
      })
      .catch(() => vivo && setErro("Erro de conexão"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (campo, valor) => { setOk(false); setCfg((c) => ({ ...c, [campo]: valor })); };
  const setDia = (i, campo, valor) => { setOk(false); setCfg((c) => ({ ...c, horarios: c.horarios.map((h, j) => (j === i ? { ...h, [campo]: valor } : h)) })); };

  const salvar = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false); setBusy(true);
    try {
      const res = await fetch("/api/atendimento/automacao", { method: "PUT", headers, body: JSON.stringify(cfg) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.error || "Não foi possível salvar"); return; }
      setCfg(data.automacao);
      setOk(true);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titulo="Resposta automática" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          {!pronto && <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800 rounded-lg p-2">Rode a migration 052 no servidor para poder ativar.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Ativar resposta automática
          </label>
          <p className="text-xs text-gray-500">Responde no máximo 1 vez a cada 12 h por conversa, nunca em grupos, nunca para quem escreveu SAIR e nunca se a equipe já respondeu. Use <code>{"{{nome}}"}</code> e <code>{"{{empresa}}"}</code> na mensagem.</p>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Boas-vindas (1ª mensagem do cliente, no horário)</label>
            <textarea value={cfg.msg_boas_vindas} onChange={(e) => set("msg_boas_vindas", e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} placeholder="Olá {{nome}}! Já já um atendente responde." />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.usar_horario} onChange={(e) => set("usar_horario", e.target.checked)} /> Definir horário de atendimento
          </label>
          {cfg.usar_horario && (
            <>
              <div className="space-y-1">
                {cfg.horarios.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-200">
                    <label className="flex items-center gap-2 w-28 cursor-pointer"><input type="checkbox" checked={h.ativo} onChange={(e) => setDia(i, "ativo", e.target.checked)} />{DIAS[i]}</label>
                    <input type="time" value={h.de} disabled={!h.ativo} onChange={(e) => setDia(i, "de", e.target.value)} className={`${inputCls} !w-28 min-w-0`} aria-label={`${DIAS[i]} início`} />
                    <span className="text-gray-500">às</span>
                    <input type="time" value={h.ate} disabled={!h.ativo} onChange={(e) => setDia(i, "ate", e.target.value)} className={`${inputCls} !w-28 min-w-0`} aria-label={`${DIAS[i]} fim`} />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Mensagem fora do horário</label>
                <textarea value={cfg.msg_fora_horario} onChange={(e) => set("msg_fora_horario", e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} placeholder="Estamos fora do horário. Respondemos a partir das 8h." />
              </div>
            </>
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
