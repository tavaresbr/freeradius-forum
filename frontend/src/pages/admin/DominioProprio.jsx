import React, { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const ROTULO = { pendente: "Aguardando DNS", dns_ok: "DNS ok — falta ativar o HTTPS", ativo: "Ativo", erro: "Erro" };
const COR = { pendente: "bg-yellow-900/30 text-yellow-400", dns_ok: "bg-blue-900/30 text-blue-400", ativo: "bg-green-900/30 text-green-400", erro: "bg-red-900/30 text-red-400" };

export default function DominioProprio() {
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const [d, setD] = useState(null);
  const [entrada, setEntrada] = useState("");
  const [msg, setMsg] = useState(null); // { tipo: "ok"|"erro", texto }
  const [ocupado, setOcupado] = useState("");

  const aplicar = (r) => { setD(r); setEntrada(r.dominio || ""); };
  const carregar = useCallback(async () => {
    const r = await fetch("/api/dominio", { headers });
    const j = await r.json().catch(() => ({}));
    if (r.ok) aplicar(j); else setMsg({ tipo: "erro", texto: j.message || j.error || "Erro ao carregar." });
  }, []);
  useEffect(() => { carregar().catch(() => {}); }, [carregar]);

  const chamar = async (rotulo, url, metodo, corpo) => {
    setOcupado(rotulo); setMsg(null);
    try {
      const r = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j.message || j.error || "Erro." }); carregar().catch(() => {}); return null; }
      if (j.ok === false) { setMsg({ tipo: "erro", texto: j.mensagem }); return j; }
      return j;
    } finally { setOcupado(""); }
  };

  const salvar = async (e) => {
    e.preventDefault();
    const j = await chamar("salvar", "/api/dominio", "PUT", { dominio: entrada });
    if (j) { aplicar(j); setMsg({ tipo: "ok", texto: "Domínio salvo. Agora crie o apontamento de DNS abaixo." }); }
  };
  const verificar = async () => {
    const j = await chamar("verificar", "/api/dominio/verificar", "POST");
    if (j && j.ok) { aplicar(j); setMsg({ tipo: "ok", texto: "DNS conferido! Agora ative o HTTPS." }); }
  };
  const ativar = async () => {
    const j = await chamar("ativar", "/api/dominio/ativar", "POST");
    if (j) { aplicar(j); setMsg({ tipo: "ok", texto: "Domínio ativo! Reenvie o hotspot nos equipamentos para usar o novo endereço." }); }
  };
  const remover = async () => {
    if (!confirm("Remover o domínio próprio? O portal volta a usar o domínio da plataforma.")) return;
    const j = await chamar("remover", "/api/dominio", "DELETE");
    if (j) { aplicar(j); setMsg({ tipo: "ok", texto: "Domínio removido." }); }
  };

  const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm";
  const btn = "px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50";

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Domínio próprio</h1>
          <p className="text-sm text-gray-400">Use um endereço seu (ex.: wifi.suaempresa.com.br) no portal dos seus clientes. O painel continua no endereço da plataforma.</p>
        </div>

        {msg && <div data-testid="msg" className={`rounded-lg px-4 py-3 text-sm ${msg.tipo === "ok" ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"}`}>{msg.texto}</div>}

        {d && d.automatico === false && (
          <div className="rounded-lg px-4 py-3 text-sm bg-yellow-900/30 text-yellow-300">A ativação automática do HTTPS não está disponível neste servidor. Peça ao suporte da plataforma.</div>
        )}

        <form onSubmit={salvar} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
          <label className="block text-sm text-gray-400">1. Seu domínio</label>
          <div className="flex gap-2 flex-wrap">
            <input className={`${inputCls} flex-1 min-w-0`} placeholder="wifi.suaempresa.com.br" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            <button className={`${btn} bg-blue-600 text-white`} disabled={!!ocupado || !entrada.trim()}>{ocupado === "salvar" ? "Salvando..." : "Salvar"}</button>
          </div>
          {d?.status && <span className={`inline-block text-xs px-2 py-1 rounded-full ${COR[d.status]}`} data-testid="status">{ROTULO[d.status]}</span>}
          {d?.erro && <p className="text-xs text-red-400">{d.erro}</p>}
        </form>

        {d?.dominio && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
            <p className="text-sm text-gray-400">2. No painel do seu provedor de domínio, crie este apontamento:</p>
            <div className="text-sm text-gray-200 bg-[#0d1117] rounded-lg p-3 space-y-1 font-mono break-all">
              <div>Tipo: <b>CNAME</b></div>
              <div>Nome: <b>{d.dominio}</b></div>
              <div>Valor: <b>{d.alvo}</b></div>
            </div>
            <p className="text-xs text-gray-500">Se o seu domínio não aceita CNAME nesse nome, use um registro A com o mesmo IP do endereço acima. A propagação pode levar alguns minutos.</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={verificar} className={`${btn} bg-gray-700 text-white`} disabled={!!ocupado}>{ocupado === "verificar" ? "Verificando..." : "3. Verificar DNS"}</button>
              <button type="button" onClick={ativar} className={`${btn} bg-green-600 text-white`} disabled={!!ocupado || !["dns_ok", "erro", "ativo"].includes(d.status) || d.automatico === false}>
                {ocupado === "ativar" ? "Ativando (até 2 min)..." : d.status === "ativo" ? "Reemitir HTTPS" : "4. Ativar HTTPS"}
              </button>
              <button type="button" onClick={remover} className={`${btn} bg-red-900/40 text-red-300`} disabled={!!ocupado}>Remover</button>
            </div>
          </div>
        )}

        {d?.status === "ativo" && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-2" data-testid="ativo">
            <p className="text-sm text-gray-300">Seu portal agora abre em <b className="font-mono">{d.portal_base}</b>.</p>
            <p className="text-xs text-gray-500">Em Equipamentos, use "Enviar hotspot" de novo em cada MikroTik para o login e o walled garden passarem a usar o novo endereço. Em Omada/UniFi/Grandstream, troque a URL do portal externo por esse endereço.</p>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
