import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import Moldura from "../../components/admin/Moldura";

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
        <input type="file" accept=".csv,.txt,.xlsx" onChange={escolher} className="text-sm text-gray-300 w-full max-w-full" />
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

function ResultadoContatos({ r }) {
  if (!r) return null;
  const itens = [
    ["Contatos lidos", r.total, "text-gray-200"],
    [r.simulacao ? "Seriam criados" : "Criados", r.criados, "text-green-400"],
    ["Já cadastrados", r.ignorados, "text-yellow-400"],
  ];
  if (r.invalidos) itens.push(["Sem telefone válido", r.invalidos, "text-red-400"]);
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
      <h3 className="text-white font-semibold">{r.simulacao ? "Simulação (nada foi gravado)" : "Importação concluída"}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {itens.map(([rot, val, cor]) => (
          <div key={rot} className="bg-[#0f111a] border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">{rot}</p>
            <p className={`text-xl font-bold ${cor}`}>{val}</p>
          </div>
        ))}
      </div>
      {r.amostra?.length > 0 && (
        <ul className="text-xs text-gray-400 space-y-1">
          {r.amostra.map((c, i) => <li key={i}>{c.nome} — {c.telefone}</li>)}
        </ul>
      )}
    </div>
  );
}

function ArquivoContatos({ token, tipo, instrucao }) {
  const [arquivo, setArquivo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [r, setR] = useState(null);

  const enviar = async (simular) => {
    setBusy(true);
    setMsg("");
    setR(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("simular", simular ? "true" : "false");
      const res = await fetch(`${API}/api/clientes-import/${tipo}/importar`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.message || "Erro ao importar"); return; }
      setR(data);
    } catch {
      setMsg("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
        <p className="text-gray-300 text-sm">
          {instrucao} Entram nome, telefone e e-mail; contatos sem telefone válido e telefones já cadastrados são ignorados.
        </p>
        <p className="text-xs text-yellow-400">
          Esses cadastros entram sem CPF e sem consentimento LGPD (origem "{tipo}"). Antes de enviar promoções, filtre por consentimento ou origem.
        </p>
        <input type="file" accept=".csv,.vcf" onChange={(e) => { setArquivo(e.target.files[0] || null); setR(null); setMsg(""); }} className="text-sm text-gray-300 w-full max-w-full" />
        <div className="flex gap-3 flex-wrap">
          <button disabled={!arquivo || busy} onClick={() => enviar(true)} className={btnSecondary}>Simular</button>
          <button disabled={!arquivo || busy} onClick={() => enviar(false)} className={btnPrimary}>{busy ? "Processando..." : "Importar contatos"}</button>
        </div>
      </div>
      {msg && <p className="text-red-400 text-sm">{msg}</p>}
      <ResultadoContatos r={r} />
    </div>
  );
}

function Google({ token }) {
  return (
    <ArquivoContatos
      token={token}
      tipo="google"
      instrucao={<>Em <strong>contacts.google.com</strong> clique em <strong>Exportar</strong>, escolha <strong>Google CSV</strong> (ou vCard) e envie o arquivo aqui.</>}
    />
  );
}

function Outlook({ token }) {
  return (
    <ArquivoContatos
      token={token}
      tipo="outlook"
      instrucao={<>No Outlook, em <strong>Pessoas › Gerenciar › Exportar contatos</strong> (ou <strong>Arquivo › Abrir e Exportar</strong> no Outlook clássico), exporte em <strong>CSV</strong> e envie o arquivo aqui.</>}
    />
  );
}

function Icloud({ token }) {
  return (
    <ArquivoContatos
      token={token}
      tipo="icloud"
      instrucao={<>Em <strong>icloud.com/contacts</strong>, selecione os contatos (Ctrl/Cmd + A), clique na engrenagem e em <strong>Exportar vCard</strong>, e envie o arquivo <strong>.vcf</strong> aqui.</>}
    />
  );
}

function Whatsapp({ token, empresaSlug }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [r, setR] = useState(null);

  const enviar = async (simular) => {
    setBusy(true);
    setMsg("");
    setR(null);
    try {
      const res = await fetch(`${API}/api/clientes-import/whatsapp/importar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ simular }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.message || "Erro ao importar"); return; }
      setR(data);
    } catch {
      setMsg("Erro de conexão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
        <p className="text-gray-300 text-sm">
          Importa os contatos do <strong>WhatsApp conectado</strong> (nome e telefone) como clientes. Contatos cujo telefone já existe no cadastro são ignorados;
          grupos não entram. A instância precisa estar conectada em <Link to={`/admin/${empresaSlug}/whatsapp`} className="text-blue-400 hover:text-blue-300">WhatsApp</Link>.
        </p>
        <p className="text-xs text-yellow-400">
          Esses cadastros entram sem CPF e sem consentimento LGPD (origem "whatsapp"). Antes de enviar promoções, filtre por consentimento ou origem.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy} onClick={() => enviar(true)} className={btnSecondary}>Simular</button>
          <button disabled={busy} onClick={() => enviar(false)} className={btnPrimary}>{busy ? "Processando..." : "Importar contatos"}</button>
        </div>
      </div>
      {msg && <p className="text-red-400 text-sm">{msg}</p>}
      <ResultadoContatos r={r} />
    </div>
  );
}

function Sgp({ empresaSlug }) {
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
      <p className="text-gray-300 text-sm">
        A importação do SGP agora fica em <strong>Configurações › Integrações › SGP</strong>, onde você salva as credenciais, testa a conexão,
        vê uma amostra e simula antes de importar.
      </p>
      <Link to={`/admin/${empresaSlug}/integracoes/sgp`} className={btnPrimary + " inline-block"}>Abrir integração SGP</Link>
    </div>
  );
}

function Exportar({ token }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ tipo: "", texto: "" });

  const baixar = async (formato, nomeArquivo) => {
    setBusy(formato);
    setMsg({ tipo: "", texto: "" });
    try {
      const t = await fetch(`${API}/api/auth/download-token?para=leads`, { headers: { Authorization: `Bearer ${token}` } });
      if (!t.ok) throw new Error("Sessão expirada. Faça login novamente.");
      const { token: dl } = await t.json();
      const qs = new URLSearchParams({ token: dl, formato });
      if (status) qs.set("status", status);
      const r = await fetch(`${API}/api/leads/export-contatos?${qs}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(r.status === 403 && d.code === "RECURSO_NAO_CONTRATADO" ? "A exportação da base não está incluída no seu plano." : d.message || d.error || "Não foi possível exportar.");
      }
      const total = r.headers.get("X-Total-Contatos");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ tipo: "ok", texto: total === "0" ? "Nenhum cliente com telefone válido para exportar." : `${total || ""} contato(s) exportado(s).` });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e.message || "Não foi possível exportar." });
    } finally {
      setBusy("");
    }
  };

  const opcoes = [
    ["google", "Google Contatos (CSV)", "contatos-google.csv", <>Em <strong>contacts.google.com</strong> use <strong>Importar</strong> e escolha este arquivo.</>],
    ["outlook", "Outlook (CSV)", "contatos-outlook.csv", <>No Outlook use <strong>Arquivo &gt; Abrir e Exportar &gt; Importar/Exportar</strong> e escolha este arquivo.</>],
    ["vcard", "iCloud / celular (vCard .vcf)", "contatos.vcf", <>Em <strong>icloud.com/contacts</strong> use a engrenagem &gt; <strong>Importar vCard</strong>. Serve também para Android e iPhone.</>],
  ];

  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-4">
      <p className="text-gray-400 text-sm">Baixe seus clientes como lista de contatos (nome, telefone e e-mail). Só entram clientes com telefone válido, sem repetir o mesmo número.</p>
      <div className="max-w-xs">
        <label className="block text-sm text-gray-400 mb-1">Quais clientes</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="">Todos</option>
          <option value="novo">Novos</option>
          <option value="contactado">Contactados</option>
          <option value="convertido">Convertidos</option>
          <option value="descartado">Descartados</option>
        </select>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {opcoes.map(([k, rot, arquivo, ajuda]) => (
          <div key={k} className="border border-gray-800 rounded-lg p-4 space-y-3">
            <button onClick={() => baixar(k, arquivo)} disabled={!!busy} className={btnPrimary + " w-full"}>
              {busy === k ? "Gerando..." : `Exportar ${rot}`}
            </button>
            <p className="text-xs text-gray-500">{ajuda}</p>
          </div>
        ))}
      </div>
      {msg.texto && <p className={`text-sm ${msg.tipo === "erro" ? "text-red-400" : "text-green-400"}`}>{msg.texto}</p>}
      <p className="text-xs text-gray-500">Os contatos são dados pessoais dos seus clientes (LGPD): use só para a finalidade informada a eles e não compartilhe o arquivo.</p>
    </div>
  );
}

export default function ImportarClientes({ embutido = false }) {
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
    <Moldura embutido={embutido}>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Importar e exportar contatos</h1>
            <p className="text-gray-400 text-sm mt-1">Traga cadastros de outro sistema (SGP), de uma planilha, do WhatsApp, do Google, do Outlook ou do iCloud, ou exporte seus clientes como contatos</p>
          </div>
          {!embutido && <Link to={`/admin/${empresaSlug}/leads`} className={btnSecondary}>Voltar para Clientes</Link>}
        </div>

        <div className="flex flex-wrap gap-2">
          {[["planilha", "Planilha (CSV / XLSX)"], ["sgp", "SGP (API)"], ["whatsapp", "WhatsApp"], ["google", "Google Contatos"], ["outlook", "Outlook"], ["icloud", "iCloud"], ["exportar", "Exportar contatos"]].map(([k, rot]) => (
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

        {origem === "planilha" ? <Planilha token={token} campos={campos} />
          : origem === "whatsapp" ? <Whatsapp token={token} empresaSlug={empresaSlug} />
          : origem === "google" ? <Google token={token} />
          : origem === "outlook" ? <Outlook token={token} />
          : origem === "icloud" ? <Icloud token={token} />
          : origem === "exportar" ? <Exportar token={token} />
          : <Sgp empresaSlug={empresaSlug} />}
      </div>
    </Moldura>
  );
}
