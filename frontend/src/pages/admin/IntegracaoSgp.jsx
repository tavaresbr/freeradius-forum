import React, { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

const API = "";
const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimary = "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

function Resumo({ r }) {
  const itens = [
    ["Total", r.total, "text-gray-200"],
    [r.simulacao ? "Seriam criados" : "Criados", r.criados, "text-green-400"],
    [r.simulacao ? "Seriam completados" : "Completados", r.atualizados, "text-blue-400"],
    ["Repetidos", r.ignorados, "text-yellow-400"],
    ["Com erro", r.erros.length, "text-red-400"],
  ];
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
      <h3 className="text-white font-semibold">{r.simulacao ? "Simulação (nada foi gravado)" : "Importação concluída"}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {itens.map(([rot, val, cor]) => (
          <div key={rot} className="bg-[#0f111a] border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">{rot}</p>
            <p className={`text-xl font-bold ${cor}`}>{val}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">Clientes que já existem (mesmo CPF/CNPJ) só têm os campos vazios preenchidos; o consentimento LGPD não é alterado.</p>
      {r.erros.length > 0 && (
        <ul className="text-xs text-red-300 space-y-1 max-h-40 overflow-y-auto">
          {r.erros.slice(0, 20).map((e, i) => <li key={i}>Registro {e.linha}: {e.motivo}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function IntegracaoSgp() {
  const { empresaSlug } = useParams();
  const [cfg, setCfg] = useState({ url: "", app: "", endpoint: "/api/ura/clientes/", token: "", sync_auto: false, sync_horas: 24 });
  const [ultimaSync, setUltimaSync] = useState(null);
  const [tokenDefinido, setTokenDefinido] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [busy, setBusy] = useState("");
  const [teste, setTeste] = useState(null);
  const [amostra, setAmostra] = useState(null);
  const [resultado, setResultado] = useState(null);

  const token = localStorage.getItem("admin_token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/integracoes/sgp`, { headers });
      const d = await res.json();
      setCfg((c) => ({ ...c, url: d.url || "", app: d.app || "", endpoint: d.endpoint || c.endpoint, sync_auto: !!d.sync_auto, sync_horas: d.sync_horas || 24 }));
      setUltimaSync(d.ultima_sync || null);
      setTokenDefinido(!!d.token_definido);
    } catch { /* formulario segue vazio */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  const chamar = async (nome, rota, metodo, corpo) => {
    setBusy(nome);
    setMsg({ tipo: "", texto: "" });
    try {
      const res = await fetch(`${API}/api/integracoes/sgp${rota}`, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { message: "Erro de conexão com o servidor" } };
    } finally {
      setBusy("");
    }
  };

  const erro = (data) => setMsg({ tipo: "erro", texto: data.message || "Erro" });

  const salvar = async () => {
    const { ok, data } = await chamar("salvar", "", "PUT", cfg);
    if (!ok) return erro(data);
    setMsg({ tipo: "ok", texto: data.message || "Salvo" });
    setCfg((c) => ({ ...c, token: "" }));
    setTokenDefinido(true);
    carregar();
  };

  const testar = async () => {
    setTeste(null);
    const { ok, data } = await chamar("testar", "/testar", "POST");
    if (!ok) return erro(data);
    setTeste(data);
    setMsg({ tipo: "ok", texto: `Conexão ok (HTTP ${data.http}) — ${data.registros} registro(s) na primeira página` });
  };

  const verAmostra = async () => {
    setAmostra(null);
    const { ok, data } = await chamar("amostra", "/amostra", "POST");
    if (!ok) return erro(data);
    setAmostra(data.registros);
  };

  const importar = async (simular) => {
    if (!simular && !confirm("Importar os clientes do SGP agora? Clientes já existentes só terão campos vazios preenchidos.")) return;
    setResultado(null);
    const { ok, data } = await chamar(simular ? "simular" : "importar", "/importar", "POST", { simular });
    if (ok) {
      setResultado(data);
      setMsg({ tipo: "", texto: "" });
    } else {
      erro(data);
      if (data.campos) setTeste({ http: "-", registros: 0, campos: data.campos, mapeamento: data.mapeamento || {}, identificou: { nome: !!(data.mapeamento || {}).nome, documento: false } });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Integração SGP</h1>
            <p className="text-gray-400 text-sm mt-1">Configurações › Integrações › SGP</p>
          </div>
          <Link to={`/admin/${empresaSlug}/integracoes`} className={btnSecondary}>Voltar</Link>
        </div>

        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
          <p className="text-gray-300 text-sm">Informe os dados de acesso à API do seu SGP. O token fica salvo só no servidor e não é exibido novamente.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">URL do SGP</label>
              <input className={inputCls} placeholder="https://sgp.suaempresa.com.br" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">App</label>
              <input className={inputCls} value={cfg.app} onChange={(e) => setCfg({ ...cfg, app: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Token {tokenDefinido && <span className="text-green-400">(já salvo — deixe em branco para manter)</span>}
              </label>
              <input type="password" autoComplete="new-password" className={inputCls} value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Endpoint de clientes</label>
              <input className={inputCls} value={cfg.endpoint} onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })} />
            </div>
          </div>
          <div className="border-t border-gray-800 pt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={cfg.sync_auto} onChange={(e) => setCfg({ ...cfg, sync_auto: e.target.checked })} />
              Importar clientes do SGP automaticamente
            </label>
            {cfg.sync_auto && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                A cada
                <select className={`${inputCls} !w-auto`} value={cfg.sync_horas} onChange={(e) => setCfg({ ...cfg, sync_horas: Number(e.target.value) })}>
                  {[1, 6, 12, 24, 48, 168].map((h) => <option key={h} value={h}>{h === 168 ? "7 dias" : h === 48 ? "2 dias" : `${h} hora${h > 1 ? "s" : ""}`}</option>)}
                </select>
              </div>
            )}
            {ultimaSync && (
              <p className={`text-xs ${ultimaSync.ok ? "text-gray-500" : "text-red-400"}`}>
                Última sincronização: {new Date(ultimaSync.em).toLocaleString("pt-BR")} —{" "}
                {ultimaSync.ok
                  ? `${ultimaSync.total} lido(s), ${ultimaSync.criados} criado(s), ${ultimaSync.atualizados} completado(s), ${ultimaSync.erros} com erro`
                  : `falhou: ${ultimaSync.erro}`}
              </p>
            )}
          </div>
          <button disabled={!!busy} onClick={salvar} className={btnPrimary}>{busy === "salvar" ? "Salvando..." : "Salvar"}</button>
        </div>

        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
          <p className="text-gray-300 text-sm">Teste em etapas: primeiro a conexão, depois uma amostra mascarada e a simulação. Só então importe.</p>
          <div className="flex gap-3 flex-wrap">
            <button disabled={!!busy} onClick={testar} className={btnSecondary}>{busy === "testar" ? "Testando..." : "1. Testar conexão"}</button>
            <button disabled={!!busy} onClick={verAmostra} className={btnSecondary}>{busy === "amostra" ? "Buscando..." : "2. Ver amostra"}</button>
            <button disabled={!!busy} onClick={() => importar(true)} className={btnSecondary}>{busy === "simular" ? "Simulando..." : "3. Simular importação"}</button>
            <button disabled={!!busy} onClick={() => importar(false)} className={btnPrimary}>{busy === "importar" ? "Importando..." : "4. Importar"}</button>
          </div>
          {msg.texto && <p className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}

          {teste && (
            <div className="space-y-2 text-sm">
              <p className={teste.identificou.nome ? "text-green-400" : "text-yellow-400"}>
                {teste.identificou.nome ? "✓" : "✗"} Campo de nome {teste.identificou.nome ? `identificado (${teste.mapeamento.nome})` : "não identificado"}
              </p>
              <p className={teste.identificou.documento ? "text-green-400" : "text-yellow-400"}>
                {teste.identificou.documento ? "✓" : "✗"} Campo de CPF/CNPJ {teste.identificou.documento ? `identificado (${teste.mapeamento.cpf || teste.mapeamento.cnpj})` : "não identificado"}
              </p>
              <details className="text-xs text-gray-400">
                <summary className="cursor-pointer">Campos recebidos do SGP ({teste.campos.length})</summary>
                <p className="mt-2 break-words">{teste.campos.join(", ")}</p>
              </details>
            </div>
          )}

          {amostra && (
            <div className="text-xs text-gray-400 overflow-x-auto">
              <p className="mb-2">Amostra com dados pessoais mascarados ({amostra.length} registro(s)):</p>
              {amostra.map((r, i) => (
                <pre key={i} className="bg-[#0f111a] border border-gray-800 rounded-lg p-3 mb-2 whitespace-pre-wrap break-words">{JSON.stringify(r, null, 2)}</pre>
              ))}
            </div>
          )}
        </div>

        {resultado && <Resumo r={resultado} />}
      </div>
    </AdminLayout>
  );
}
