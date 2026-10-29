import React, { useState } from "react";
import { Link } from "react-router-dom";
import { inputCls, btnPrimary, btnSecondary } from "./Modal";

const STATUS = { novo: "Novo", contactado: "Contactado", convertido: "Convertido", descartado: "Descartado" };
const brl = (v) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const data = (v) => (v ? new Date(v).toLocaleDateString("pt-BR") : "");

function Linha({ rotulo, children }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className="text-sm text-gray-200 break-words">{children}</p>
    </div>
  );
}

// Resumo do cliente ligado a conversa (CPF mascarado) + criar/vincular cliente.
export default function PainelCliente({ dados, carregando, empresaSlug, conversa, headers, onMudou, onEnviarPlanos }) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState("");
  const [achados, setAchados] = useState([]);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const chamar = async (url, opts) => {
    setBusy(true);
    setErro("");
    try {
      const res = await fetch(url, { headers, ...opts });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.error || "Erro ao salvar"); return false; }
      await onMudou();
      return true;
    } catch {
      setErro("Erro de conexão");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const buscar = async (valor) => {
    setQ(valor);
    if (valor.trim().length < 2) { setAchados([]); return; }
    try {
      const res = await fetch(`/api/atendimento/clientes?q=${encodeURIComponent(valor.trim())}`, { headers });
      if (res.ok) setAchados((await res.json()).clientes || []);
    } catch { /* tenta de novo ao digitar */ }
  };

  const vincular = async (leadId) => {
    if (await chamar(`/api/atendimento/conversas/${conversa.id}/vincular`, { method: "POST", body: JSON.stringify({ lead_id: leadId }) })) { setBuscando(false); setQ(""); setAchados([]); }
  };

  const lead = dados?.lead;
  return (
    <div className="p-4 space-y-4 text-left">
      <h3 className="text-sm font-semibold text-white">Cliente</h3>
      {carregando && !dados && <p className="text-sm text-gray-500">Carregando…</p>}
      {dados && lead && (
        <>
          <Linha rotulo="Nome">{lead.nome}</Linha>
          <Linha rotulo="CPF">{lead.cpf}</Linha>
          <Linha rotulo="Telefone">{lead.telefone}</Linha>
          <Linha rotulo="E-mail">{lead.email}</Linha>
          <Linha rotulo="Situação">{`${STATUS[lead.status] || lead.status || ""}${lead.origem ? ` · origem ${lead.origem}` : ""}`}</Linha>
          {lead.sem_promocoes && <p className="text-xs text-yellow-400">Pediu para não receber promoções.</p>}
          {!lead.lgpd_aceite && <p className="text-xs text-gray-500">Sem consentimento LGPD registrado.</p>}
          {dados.plano && <Linha rotulo="Plano atual">{`${dados.plano.nome}${dados.plano.duracao_minutos ? ` (${dados.plano.duracao_minutos} min)` : ""}`}</Linha>}
          {dados.saldo && (
            <Linha rotulo="Tempo restante">{dados.saldo.ativo ? `${Math.max(1, Math.ceil(dados.saldo.restante_segundos / 60))} min` : "Esgotado"}</Linha>
          )}
          {dados.ultimo_pagamento && (
            <Linha rotulo="Último pagamento">
              {`${brl(dados.ultimo_pagamento.valor)} · ${dados.ultimo_pagamento.status}${dados.ultimo_pagamento.plano ? ` · ${dados.ultimo_pagamento.plano}` : ""} · ${data(dados.ultimo_pagamento.criado_em)}`}
            </Linha>
          )}
          <div className="flex gap-2 flex-wrap">
            {dados.link_planos && onEnviarPlanos && <button onClick={() => onEnviarPlanos(dados.link_planos)} className={btnPrimary} title="Coloca na caixa de mensagem o link dos planos do portal">💳 Enviar planos</button>}
            <Link to={`/admin/${empresaSlug}/leads`} className={`${btnSecondary} inline-block`}>Abrir em Clientes</Link>
            <button onClick={() => chamar(`/api/atendimento/conversas/${conversa.id}/vincular`, { method: "POST", body: JSON.stringify({ lead_id: null }) })} disabled={busy} className="text-xs text-gray-400 hover:text-red-400 cursor-pointer">desvincular</button>
          </div>
        </>
      )}
      {dados && !lead && (
        <>
          <p className="text-sm text-gray-400">Este contato ainda não está ligado a um cliente.</p>
          <div className="flex gap-2 flex-wrap">
            {conversa.telefone && <button onClick={() => chamar(`/api/atendimento/conversas/${conversa.id}/criar-cliente`, { method: "POST", body: JSON.stringify({}) })} disabled={busy} className={btnPrimary}>Cadastrar como cliente</button>}
            <button onClick={() => setBuscando((v) => !v)} className={btnSecondary}>Vincular a um cliente</button>
          </div>
          {buscando && (
            <div className="space-y-2">
              <input value={q} onChange={(e) => buscar(e.target.value)} placeholder="Nome, telefone ou e-mail" className={inputCls} autoFocus />
              {achados.map((c) => (
                <button key={c.id} onClick={() => vincular(c.id)} className="w-full text-left px-3 py-2 rounded-lg bg-[#0f111a] border border-gray-800 hover:bg-[#252b3b] cursor-pointer">
                  <span className="block text-sm text-gray-200 truncate">{c.nome}</span>
                  <span className="block text-xs text-gray-500 truncate">{[c.telefone, c.email].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
              {q.trim().length >= 2 && achados.length === 0 && <p className="text-xs text-gray-500">Nenhum cliente encontrado.</p>}
            </div>
          )}
          <p className="text-xs text-gray-500">O cadastro novo fica sem CPF e sem consentimento LGPD (origem "whatsapp").</p>
        </>
      )}
      {erro && <p className="text-sm text-red-400">{erro}</p>}
    </div>
  );
}
