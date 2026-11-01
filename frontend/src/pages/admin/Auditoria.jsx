import React, { useCallback, useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const ROTULOS = {
  "cliente.excluir": "Excluiu cliente", "cliente.excluir_massa": "Excluiu clientes em massa", "cliente.editar_massa": "Editou clientes em massa",
  "cliente.exportar": "Exportou a base de clientes", "plano.criar": "Criou plano", "plano.editar": "Editou plano", "plano.excluir": "Excluiu plano",
  "usuario.criar": "Criou usuário", "usuario.editar": "Editou usuário", "usuario.excluir": "Excluiu usuário",
  "equipamento.criar": "Cadastrou equipamento", "equipamento.editar": "Editou equipamento", "equipamento.excluir": "Excluiu equipamento", "equipamento.wifi": "Alterou o nome do Wi-Fi", "vpn.renomear": "Renomeou peer da VPN",
  "portal.excluir": "Excluiu portal", "config.salvar": "Alterou configuração", "limpeza.executar": "Executou limpeza de dados",
  "voucher.massa": "Ação em massa em vouchers", "promocao.iniciar": "Iniciou promoção por WhatsApp",
};
const rotulo = (a) => ROTULOS[a] || a;
const dataHora = (v) => (v ? new Date(v).toLocaleString("pt-BR") : "");

export default function Auditoria() {
  const token = localStorage.getItem("admin_token");
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [acao, setAcao] = useState("");
  const [q, setQ] = useState("");
  const [qAplicada, setQAplicada] = useState("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => { const t = setTimeout(() => { setQAplicada(q); setPagina(1); }, 500); return () => clearTimeout(t); }, [q]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const p = new URLSearchParams({ pagina: String(pagina) });
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      if (acao) p.set("acao", acao);
      if (qAplicada) p.set("q", qAplicada);
      const res = await fetch(`/api/auditoria?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.error || "Não foi possível carregar a auditoria"); setDados(null); return; }
      setDados(d);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setCarregando(false);
    }
  }, [de, ate, acao, qAplicada, pagina, token]);
  useEffect(() => { carregar(); }, [carregar]);

  const inputCls = "px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 text-sm min-w-0";
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Auditoria</h1>
        <p className="text-sm text-gray-400">Registro de quem fez ações sensíveis no painel (exclusões, exportações, mudanças de configuração, planos e usuários). Não guarda senhas nem dados pessoais.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">De<input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPagina(1); }} className={`${inputCls} block mt-1`} /></label>
          <label className="text-xs text-gray-500">Até<input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPagina(1); }} className={`${inputCls} block mt-1`} /></label>
          <label className="text-xs text-gray-500">Ação
            <select value={acao} onChange={(e) => { setAcao(e.target.value); setPagina(1); }} className={`${inputCls} block mt-1`} aria-label="Filtrar por ação">
              <option value="">Todas</option>
              {(dados?.acoes || []).map((a) => <option key={a} value={a}>{rotulo(a)}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Buscar<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="usuário ou detalhe" className={`${inputCls} block mt-1`} /></label>
        </div>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        {carregando && !dados && <p className="text-sm text-gray-500">Carregando…</p>}
        {dados && (
          <>
            <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-800"><th className="p-3">Quando</th><th className="p-3">Usuário</th><th className="p-3">Ação</th><th className="p-3">Detalhe</th><th className="p-3">IP</th></tr></thead>
                <tbody>
                  {dados.itens.map((l) => (
                    <tr key={l.id} className="text-gray-200 border-b border-gray-800/60">
                      <td className="p-3 whitespace-nowrap">{dataHora(l.criado_em)}</td>
                      <td className="p-3">{l.usuario || l.email || "—"}</td>
                      <td className="p-3">{rotulo(l.acao)}</td>
                      <td className="p-3 break-words">{[l.entidade_id && `#${l.entidade_id}`, l.detalhes].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="p-3">{l.ip || "—"}</td>
                    </tr>
                  ))}
                  {dados.itens.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-500">Nenhum registro no período.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>{dados.total} registro(s)</span>
              <div className="flex items-center gap-2">
                <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="px-3 py-1.5 bg-[#1a1d27] border border-gray-800 rounded-lg disabled:opacity-50 cursor-pointer">Anterior</button>
                <span>{pagina} / {totalPaginas}</span>
                <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="px-3 py-1.5 bg-[#1a1d27] border border-gray-800 rounded-lg disabled:opacity-50 cursor-pointer">Próxima</button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
