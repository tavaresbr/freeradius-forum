import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";

const VAZIO = { nome: "", descricao: "", valor: "", ciclo_dias: 30, max_equipamentos: "", max_admins: "", ativo: true, ordem: 0 };
const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm";

export default function PlanosSaas() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [planos, setPlanos] = useState([]);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [copiaDe, setCopiaDe] = useState(null);
  const [msg, setMsg] = useState("");
  const [cfg, setCfg] = useState({ access_token: "", public_key: "", webhook_secret: "", email_pagador: "", configurado: false });

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/assinatura/admin/planos", { headers }),
      fetch("/api/assinatura/admin/plataforma", { headers }),
    ]);
    if (a.ok) setPlanos(await a.json());
    if (b.ok) setCfg(await b.json());
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) { navigate("/admin"); return; }
    carregar().catch(() => {});
  }, [carregar]);

  const salvarPlano = async (e) => {
    e.preventDefault();
    const res = await fetch(editId ? `/api/assinatura/admin/planos/${editId}` : "/api/assinatura/admin/planos", {
      method: editId ? "PUT" : "POST", headers, body: JSON.stringify(form),
    });
    if (res.ok) { setForm(null); setEditId(null); setCopiaDe(null); carregar(); } else setMsg("Erro ao salvar plano");
  };

  const remover = async (id) => {
    if (!confirm("Remover este plano? Se estiver em uso ele será apenas desativado.")) return;
    const res = await fetch(`/api/assinatura/admin/planos/${id}`, { method: "DELETE", headers });
    if (res.ok) { const d = await res.json(); setMsg(d.message); carregar(); }
  };

  const salvarCfg = async (e) => {
    e.preventDefault();
    const res = await fetch("/api/assinatura/admin/plataforma", { method: "PUT", headers, body: JSON.stringify(cfg) });
    setMsg(res.ok ? "Configuração do Mercado Pago salva." : "Erro ao salvar configuração");
    if (res.ok) carregar();
  };

  // Duplicar: abre o modal de "Novo plano" ja preenchido; nasce inativo para nao aparecer na
  // landing/registro antes de ser revisado.
  const duplicar = (p) => {
    setEditId(null);
    setCopiaDe(p.nome);
    setForm({ ...p, id: undefined, nome: `${p.nome} (cópia)`, max_equipamentos: p.max_equipamentos ?? "", max_admins: p.max_admins ?? "", ativo: false, ordem: (p.ordem ?? 0) + 1 });
  };
  const editar = (p) => { setCopiaDe(null); setEditId(p.id); setForm({ ...p, max_equipamentos: p.max_equipamentos ?? "", max_admins: p.max_admins ?? "", ativo: !!p.ativo }); };
  const campo = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <AdminLayout>
      <div className="space-y-8 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Planos SaaS</h1>
            <p className="text-sm text-gray-400 mt-1">Planos de uso do sistema cobrados das empresas.</p>
          </div>
          <button onClick={() => { setEditId(null); setCopiaDe(null); setForm(VAZIO); }} className="px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-500 text-sm font-medium">Novo plano</button>
        </div>

        {msg && <p className="text-sm text-blue-300 bg-blue-900/20 p-3 rounded-lg">{msg}</p>}

        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-5 py-3">Plano</th><th className="text-left px-5 py-3">Valor</th><th className="text-left px-5 py-3">Ciclo</th>
              <th className="text-left px-5 py-3">Equip.</th><th className="text-left px-5 py-3">Admins</th><th className="text-left px-5 py-3">Status</th><th className="px-5 py-3" />
            </tr></thead>
            <tbody>
              {planos.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="px-5 py-3 text-white">{p.nome}</td>
                  <td className="px-5 py-3">R$ {Number(p.valor).toFixed(2)}</td>
                  <td className="px-5 py-3">{p.ciclo_dias} dias</td>
                  <td className="px-5 py-3">{p.max_equipamentos ?? "∞"}</td>
                  <td className="px-5 py-3">{p.max_admins ?? "∞"}</td>
                  <td className="px-5 py-3">{p.ativo ? "Ativo" : "Inativo"}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => duplicar(p)} className="px-2.5 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg text-xs mr-2">Duplicar</button>
                    <button onClick={() => editar(p)} className="px-2.5 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs mr-2">Editar</button>
                    <button onClick={() => remover(p.id)} className="px-2.5 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs">Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={salvarCfg} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-bold text-white">Mercado Pago da plataforma {cfg.configurado && <span className="text-xs text-green-400 ml-2">configurado</span>}</h2>
          <p className="text-xs text-gray-500">Recebe as assinaturas das empresas. Webhook: <code>/api/assinatura/webhook</code>. Campos mascarados (terminam em ...) são mantidos se não alterados.</p>
          {[["access_token", "Access Token"], ["public_key", "Public Key"], ["webhook_secret", "Segredo do webhook"], ["email_pagador", "E-mail do pagador (fallback)"]].map(([k, r]) => (
            <div key={k}>
              <label className="block text-sm text-gray-400 mb-1">{r}</label>
              <input className={inputCls} value={cfg[k] || ""} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} autoComplete="off" />
            </div>
          ))}
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Salvar configuração</button>
        </form>

        {form && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form onSubmit={salvarPlano} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h2 className="text-lg font-bold text-white">{editId ? "Editar plano" : copiaDe ? "Duplicar plano" : "Novo plano"}</h2>
              {copiaDe && <p className="text-xs text-gray-500">Cópia de "{copiaDe}". Ajuste e salve; nasce inativo.</p>}
              <div><label className="block text-sm text-gray-400 mb-1">Nome *</label><input required className={inputCls} value={form.nome} onChange={campo("nome")} /></div>
              <div><label className="block text-sm text-gray-400 mb-1">Descrição</label><input className={inputCls} value={form.descricao || ""} onChange={campo("descricao")} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-gray-400 mb-1">Valor (R$) *</label><input required type="number" step="0.01" min="0" className={inputCls} value={form.valor} onChange={campo("valor")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Ciclo (dias)</label><input type="number" min="1" className={inputCls} value={form.ciclo_dias} onChange={campo("ciclo_dias")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Máx. equipamentos</label><input type="number" min="0" placeholder="ilimitado" className={inputCls} value={form.max_equipamentos} onChange={campo("max_equipamentos")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Máx. admins</label><input type="number" min="0" placeholder="ilimitado" className={inputCls} value={form.max_admins} onChange={campo("max_admins")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Ordem</label><input type="number" className={inputCls} value={form.ordem} onChange={campo("ordem")} /></div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mt-6"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">Salvar</button>
                <button type="button" onClick={() => { setForm(null); setCopiaDe(null); }} className="flex-1 bg-gray-700 text-gray-300 py-2.5 rounded-lg text-sm">Cancelar</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
