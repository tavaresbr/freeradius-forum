import React, { useEffect, useState } from "react";
import Modal, { inputCls, btnPrimary, btnSecondary } from "./atendimento/Modal";

const hora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

// Avisa por WhatsApp quando um equipamento deixa de responder (desligado por padrao).
export default function AlertasEquipamentos({ onFechar }) {
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [cfg, setCfg] = useState(null);
  const [equip, setEquip] = useState([]);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [teste, setTeste] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/alertas-equipamentos", { headers })
      .then((r) => r.json().then((d) => ({ r, d })))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (!r.ok) { setErro(d.error || "Não foi possível carregar"); return; }
        setCfg({ ...d.alerta, telefones: [...d.alerta.telefones, "", "", ""].slice(0, 3) });
        setEquip(d.equipamentos || []);
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
    } catch {
      setErro("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  const salvar = (e) => {
    e.preventDefault();
    chamar("/api/alertas-equipamentos", "PUT", { ...cfg, telefones: cfg.telefones.filter((t) => t.trim()) }, "Salvo.",
      (d) => setCfg({ ...d.alerta, telefones: [...d.alerta.telefones, "", "", ""].slice(0, 3) }));
  };

  return (
    <Modal titulo="Alertas de equipamento offline" onFechar={onFechar}>
      {!cfg ? (
        <p className="text-sm text-gray-400">{erro || "Carregando..."}</p>
      ) : (
        <form onSubmit={salvar} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Avisar por WhatsApp quando um equipamento ficar offline
          </label>
          <p className="text-xs text-gray-500">Usa o WhatsApp conectado da empresa. Verifica a cada 5 minutos e só avisa após falhas seguidas (evita alarme falso); manda um único aviso por queda.</p>
          <div className="space-y-2">
            <label className="block text-sm text-gray-300">Telefones que recebem o alerta (até 3)</label>
            {cfg.telefones.map((t, i) => (
              <input key={i} value={t} onChange={(e) => setTel(i, e.target.value)} inputMode="tel" placeholder="93 99999-0000" className={inputCls} aria-label={`Telefone ${i + 1}`} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-gray-300">Falhas seguidas antes de avisar
              <select value={cfg.falhas} onChange={(e) => set("falhas", Number(e.target.value))} className={`${inputCls} !w-24 ml-2 inline-block`}>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
              <input type="checkbox" checked={cfg.avisar_volta !== false} onChange={(e) => set("avisar_volta", e.target.checked)} /> Avisar quando voltar
            </label>
          </div>
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <label className="block text-sm text-gray-300">Enviar um teste para</label>
            <div className="flex gap-2 flex-wrap">
              <input value={teste} onChange={(e) => setTeste(e.target.value)} inputMode="tel" placeholder="93 99999-0000" className={`${inputCls} !w-48 min-w-0`} />
              <button type="button" disabled={busy || !teste.trim()} className={btnSecondary}
                onClick={() => chamar("/api/alertas-equipamentos/teste", "POST", { telefone: teste }, "Teste enviado.")}>Enviar teste</button>
            </div>
          </div>
          {equip.length > 0 && (
            <div className="border-t border-gray-800 pt-3">
              <p className="text-sm text-gray-300 mb-1">Situação na última verificação</p>
              <ul className="space-y-1 text-sm">
                {equip.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 text-gray-200">
                    <span>{e.nome}{e.ip ? ` (${e.ip})` : ""}</span>
                    <span className={e.verificado_em ? (e.online ? "text-green-400" : "text-red-400") : "text-gray-500"}>
                      {e.verificado_em ? `${e.online ? "Online" : "Sem resposta"} · ${hora(e.verificado_em)}` : "ainda não verificado"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-yellow-500">Dica: use um número que NÃO seja o do próprio WhatsApp conectado.</p>
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
