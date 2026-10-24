import React, { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

const API = "";
const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";
const btnPrimary = "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary = "px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm cursor-pointer disabled:opacity-50";

function Resultado({ r }) {
  if (!r) return null;
  const baixarErros = () => {
    const csv = "linha;motivo\r\n" + r.erros.map((e) => `${e.linha};${String(e.motivo).replace(/;/g, ",")}`).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "erros-importacao.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const itens = [
    ["Total de linhas", r.total, "text-gray-200"],
    [r.simulacao ? "Seriam criados" : "Criados", r.criados, "text-green-400"],
    [r.simulacao ? "Seriam completados" : "Completados", r.atualizados, "text-blue-400"],
    ["Repetidos no arquivo", r.ignorados, "text-yellow-400"],
    ["Com erro", r.erros.length, "text-red-400"],
  ];
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="text-white font-semibold">{r.simulacao ? "Simulação (nada foi gravado)" : "Importação concluída"}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {itens.map(([rot, val, cor]) => (
          <div key={rot} className="bg-[#0f111a] border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">{rot}</p>
            <p className={`text-xl font-bold ${cor}`}>{val}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Clientes que já existiam (mesmo CPF/CNPJ) só têm os campos vazios preenchidos; nada é sobrescrito e o consentimento LGPD não é alterado.
      </p>
      {r.erros.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-300">Primeiros erros</p>
            <button onClick={baixarErros} className="text-blue-400 hover:text-blue-300 text-xs cursor-pointer">Baixar todos (CSV)</button>
          </div>
          <ul className="text-xs text-red-300 space-y-1 max-h-40 overflow-y-auto">
            {r.erros.slice(0, 20).map((e, i) => (
              <li key={i}>Linha {e.linha}: {e.motivo}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Planilha({ token, campos }) {
  const [arquivo, setArquivo] = useState(null);
  const [prev, setPrev] = useState(null);
  const [mapa, setMapa] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);

  const auth = { Authorization: `Bearer ${token}` };

  const escolher = async (e) => {
    const f = e.target.files[0];
    setArquivo(f || null);
    setPrev(null);
    setResultado(null);
    setMsg("");
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", f);
      const res = await fetch(`${API}/api/clientes-import/planilha/preview`, { method: "POST", headers: auth, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.message || "Não foi possível ler o arquivo"); return; }
      setPrev(data);
      setMapa(data.mapeamento || {});
    } catch {
      setMsg("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  const enviar = async (simular) => {
    setBusy(true);
    setMsg("");
    setResultado(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("mapeamento", JSON.stringify(mapa));
      fd.append("simular", simular ? "true" : "false");
      const res = await fetch(`${API}/api/clientes-import/planilha/importar`, { method: "POST", headers: auth, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.message || "Erro ao importar"); return; }
      setResultado(data);
    } catch {
      setMsg("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  const pronto = prev && mapa.nome && (mapa.cpf || mapa.cnpj);

  return (
    <div className="space-y-5">
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-gray-300 text-sm">Envie um arquivo <strong>CSV</strong> ou <strong>XLSX</strong> (até 5 MB / 20.000 linhas). A primeira linha deve ter os cabeçalhos.</p>
          <a href={`${API}/api/clientes-import/modelo.csv`} onClick={async (e) => {
            e.preventDefault();
            const r = await fetch(`${API}/api/clientes-import/modelo.csv`, { headers: auth });
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = url; a.download = "modelo-clientes.csv"; a.click();
            URL.revokeObjectURL(url);
          }} className="text-blue-400 hover:text-blue-300 text-sm">Baixar planilha modelo</a>
        </div>
        <input type="file" accept=".csv,.txt,.xlsx" onChange={escolher} className="text-sm text-gray-300" />
      </div>

      {prev && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
          <p className="text-gray-300 text-sm">{prev.total} linha(s) encontradas. Confira qual coluna alimenta cada campo:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campos.map(({ campo, rotulo }) => (
              <div key={campo}>
                <label className="block text-xs text-gray-400 mb-1">
                  {rotulo}{campo === "nome" || campo === "cpf" ? " *" : ""}
                </label>
                <select
                  value={mapa[campo] || ""}
                  onChange={(e) => setMapa((m) => ({ ...m, [campo]: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">— não importar —</option>
                  {prev.cabecalhos.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <details className="text-xs text-gray-400">
            <summary className="cursor-pointer">Prévia das primeiras linhas</summary>
            <div className="overflow-x-auto mt-2">
              <table className="text-xs">
                <thead><tr>{prev.cabecalhos.map((h) => <th key={h} className="text-left px-2 py-1 text-gray-300">{h}</th>)}</tr></thead>
                <tbody>
                  {prev.amostra.map((l, i) => (
                    <tr key={i}>{prev.cabecalhos.map((h) => <td key={h} className="px-2 py-1 text-gray-500 whitespace-nowrap">{String(l[h] ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="flex gap-3 flex-wrap">
            <button disabled={!pronto || busy} onClick={() => enviar(true)} className={btnSecondary}>Simular</button>
            <button disabled={!pronto || busy} onClick={() => enviar(false)} className={btnPrimary}>{busy ? "Processando..." : "Importar"}</button>
          </div>
          {!pronto && <p className="text-yellow-400 text-xs">Mapeie ao menos Nome e CPF/CNPJ.</p>}
        </div>
      )}

      {msg && <p className="text-red-400 text-sm">{msg}</p>}
      <Resultado r={resultado} />
    </div>
  );
}

function Sgp({ token }) {
  const [cfg, setCfg] = useState({ url: "", app: "", endpoint: "/api/ura/clientes/", token: "" });
  const [tokenDefinido, setTokenDefinido] = useState(false);
  const [msg, setMsg] = useState({ tipo: "", texto: "" });
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/clientes-import/sgp/config`, { headers });
      const d = await res.json();
      setCfg((c) => ({ ...c, url: d.url || "", app: d.app || "", endpoint: d.endpoint || c.endpoint }));
      setTokenDefinido(!!d.token_definido);
    } catch { /* tela segue vazia */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  const chamar = async (rota, metodo, corpo) => {
    setBusy(true);
    setMsg({ tipo: "", texto: "" });
    try {
      const res = await fetch(`${API}/api/clientes-import/sgp/${rota}`, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { message: "Erro de conexão" } };
    } finally {
      setBusy(false);
    }
  };

  const salvar = async () => {
    const { ok, data } = await chamar("config", "PUT", cfg);
    setMsg({ tipo: ok ? "ok" : "erro", texto: data.message || (ok ? "Salvo" : "Erro") });
    if (ok) { setCfg((c) => ({ ...c, token: "" })); setTokenDefinido(true); }
  };

  const testar = async () => {
    const { ok, data } = await chamar("testar", "POST");
    setMsg({ tipo: ok ? "ok" : "erro", texto: ok ? `Conexão ok (${data.amostra} registro(s) na amostra)` : data.message });
  };

  const importar = async (simular) => {
    setResultado(null);
    const { ok, data } = await chamar("importar", "POST", { simular });
    if (ok) setResultado(data);
    else setMsg({ tipo: "erro", texto: data.message || "Erro ao importar" });
  };

  return (
    <div className="space-y-5">
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
            <label className="block text-xs text-gray-400 mb-1">Token {tokenDefinido && <span className="text-green-400">(já salvo — deixe em branco para manter)</span>}</label>
            <input type="password" autoComplete="new-password" className={inputCls} value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Endpoint de clientes</label>
            <input className={inputCls} value={cfg.endpoint} onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy} onClick={salvar} className={btnPrimary}>Salvar</button>
          <button disabled={busy} onClick={testar} className={btnSecondary}>Testar conexão</button>
          <button disabled={busy} onClick={() => importar(true)} className={btnSecondary}>Simular importação</button>
          <button disabled={busy} onClick={() => importar(false)} className={btnPrimary}>{busy ? "Aguarde..." : "Importar do SGP"}</button>
        </div>
        {msg.texto && <p className={`text-sm ${msg.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{msg.texto}</p>}
      </div>
      <Resultado r={resultado} />
    </div>
  );
}

export default function ImportarClientes() {
  const { empresaSlug } = useParams();
  const [origem, setOrigem] = useState("planilha");
  const [campos, setCampos] = useState([]);
  const token = localStorage.getItem("admin_token");

  useEffect(() => {
    fetch(`${API}/api/clientes-import/campos`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setCampos(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [token]);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Importar clientes</h1>
            <p className="text-gray-400 text-sm mt-1">Traga cadastros de outro sistema (SGP) ou de uma planilha</p>
          </div>
          <Link to={`/admin/${empresaSlug}/leads`} className={btnSecondary}>Voltar para Clientes</Link>
        </div>

        <div className="flex gap-2">
          {[["planilha", "Planilha (CSV / XLSX)"], ["sgp", "SGP (API)"]].map(([k, rot]) => (
            <button
              key={k}
              onClick={() => setOrigem(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${
                origem === k ? "bg-blue-900/30 text-blue-400 border border-blue-800/50" : "bg-[#1a1d27] text-gray-400 border border-gray-800 hover:bg-[#252b3b]"
              }`}
            >
              {rot}
            </button>
          ))}
        </div>

        {origem === "planilha" ? <Planilha token={token} campos={campos} /> : <Sgp token={token} />}
      </div>
    </AdminLayout>
  );
}
