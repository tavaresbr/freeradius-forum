import React, { useEffect, useState } from "react";

// Chave geral da mensagem de confirmacao enviada ao cliente quando ele conecta no Wi-Fi (vale para todos os portais).
export default function ConfirmacaoConexao({ headers: base }) {
  const headers = { ...base, "Content-Type": "application/json" };
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null); // { tipo, texto }
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/confirmacao-conexao", { headers });
        const d = await res.json().catch(() => ({}));
        if (vivo && res.ok) setCfg({ ativo: d.ativo !== false, nao_repetir_horas: d.nao_repetir_horas ?? 24 });
      } catch { /* tela segue sem o cartao */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cfg) return null;

  const salvar = async (novo) => {
    setSalvando(true); setMsg(null);
    try {
      const res = await fetch("/api/whatsapp/confirmacao-conexao", { method: "PUT", headers, body: JSON.stringify(novo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "erro", texto: d.error || "Não foi possível salvar" }); return; }
      setCfg({ ativo: d.ativo, nao_repetir_horas: d.nao_repetir_horas });
      setMsg({ tipo: "ok", texto: "Salvo." });
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão" }); }
    finally { setSalvando(false); }
  };

  return (
    <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-6 mb-6" data-testid="confirmacao-conexao">
      <h2 className="text-lg font-semibold">Mensagem de confirmação ao conectar</h2>
      <p className="text-sm text-gray-400 mt-1">
        Quando o cliente conecta no Wi-Fi, o sistema pode mandar uma mensagem de WhatsApp com os dados do acesso. Muitas mensagens iguais em pouco tempo podem fazer o WhatsApp bloquear o número.
      </p>

      <label className="mt-4 flex items-center gap-3 cursor-pointer">
        <input type="checkbox" className="w-4 h-4" checked={cfg.ativo} disabled={salvando}
          onChange={(e) => salvar({ ...cfg, ativo: e.target.checked })} />
        <span className="text-sm">Enviar mensagem de confirmação quando o cliente conecta</span>
      </label>
      {!cfg.ativo && <p className="text-xs text-yellow-400 mt-2">Desligado: nenhum cliente recebe essa mensagem, em nenhum portal (inclusive após pagamento).</p>}

      {cfg.ativo && (
        <div className="mt-4">
          <label htmlFor="nao-repetir" className="block text-sm mb-1">Não repetir para o mesmo cliente por (horas)</label>
          <div className="flex gap-2 flex-wrap items-center">
            <input id="nao-repetir" type="number" min={0} max={168} value={cfg.nao_repetir_horas}
              onChange={(e) => setCfg({ ...cfg, nao_repetir_horas: e.target.value === "" ? "" : Number(e.target.value) })}
              className="w-28 bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
            <button type="button" disabled={salvando} onClick={() => salvar(cfg)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50 cursor-pointer">Salvar</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Vale para acesso grátis (LGPD e cadastro de lead): quem reconecta dentro desse prazo não recebe de novo. 0 = sem trava. Pagamento aprovado sempre envia a credencial.</p>
        </div>
      )}
      {msg && <p className={`text-sm mt-3 ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
