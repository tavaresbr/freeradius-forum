import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { ITENS_SITE, itensDoPlano } from "../../utils/itensSitePlano";
import { useAuth } from "../../contexts/AuthContext";

const VAZIO = { nome: "", descricao: "", valor: "", ciclo_dias: 30, max_equipamentos: "", max_admins: "", max_portais: "", inclui_whatsapp: false, inclui_campanhas: false, inclui_exportacao: false, inclui_dominio: false, gratis: false, trial_dias: "", ativo: true, ordem: 0, exibir_site: [] };
const TIPOS = [
  ["equipamentos", "Equipamentos (sobe o limite)"], ["admins", "Administradores (sobe o limite)"],
  ["portais", "Portal cativo extra"], ["whatsapp", "Módulo WhatsApp"], ["campanhas", "Módulo Campanhas"],
  ["exportacao", "Exportação da base"], ["sem_marca", "Remover marca Apex"], ["dominio", "Domínio próprio"],
];
const TIPOS_ATIVOS = ["equipamentos", "admins", "portais", "whatsapp", "campanhas", "exportacao", "dominio"]; // sem_marca ainda nao tem efeito: so inativo
const VAZIO_AD = { nome: "", descricao: "", tipo: "equipamentos", incremento: 1, valor: "", ciclo_dias: 30, plano_minimo_id: "", ativo: true, ordem: 0 };
const inputCls = "w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm";

export default function PlanosSaas() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [planos, setPlanos] = useState([]);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [copiaDe, setCopiaDe] = useState(null);
  const [msg, setMsg] = useState("");
  const [adicionais, setAdicionais] = useState([]);
  const [donos, setDonos] = useState([]);
  const [formAd, setFormAd] = useState(null);
  const [editAdId, setEditAdId] = useState(null);
  const [cfg, setCfg] = useState({ access_token: "", public_key: "", webhook_secret: "", email_pagador: "", configurado: false });

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      fetch("/api/assinatura/admin/planos", { headers }),
      fetch("/api/assinatura/admin/plataforma", { headers }),
      fetch("/api/assinatura/admin/adicionais", { headers }),
    ]);
    if (a.ok) setPlanos(await a.json());
    if (b.ok) setCfg(await b.json());
    if (c.ok) setAdicionais(await c.json());
    const d = await fetch("/api/plataforma/donos", { headers });
    if (d.ok) setDonos(await d.json());
  }, []);

  const alternarDono = async (u) => {
    const res = await fetch(`/api/plataforma/donos/${u.id}`, { method: "PUT", headers, body: JSON.stringify({ dono: !u.dono }) });
    const d = await res.json().catch(() => ({}));
    setMsg(d.message || (res.ok ? "Salvo." : "Erro ao salvar"));
    carregar();
  };

  useEffect(() => {
    if (!isSuperAdmin) { navigate("/admin"); return; }
    carregar().catch(() => {});
  }, [carregar]);

  const salvarPlano = async (e) => {
    e.preventDefault();
    const res = await fetch(editId ? `/api/assinatura/admin/planos/${editId}` : "/api/assinatura/admin/planos", {
      method: editId ? "PUT" : "POST", headers, body: JSON.stringify(form),
    });
    const dados = await res.json().catch(() => ({}));
    if (res.ok) { setForm(null); setEditId(null); setCopiaDe(null); setMsg(dados.aviso || ""); carregar(); } else setMsg(dados.message || "Erro ao salvar plano");
  };

  const remover = async (id) => {
    if (!confirm("Remover este plano? Se estiver em uso ele será apenas desativado.")) return;
    const res = await fetch(`/api/assinatura/admin/planos/${id}`, { method: "DELETE", headers });
    if (res.ok) { const d = await res.json(); setMsg(d.message); carregar(); }
  };

  const salvarAdicional = async (e) => {
    e.preventDefault();
    const res = await fetch(editAdId ? `/api/assinatura/admin/adicionais/${editAdId}` : "/api/assinatura/admin/adicionais", {
      method: editAdId ? "PUT" : "POST", headers, body: JSON.stringify(formAd),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setFormAd(null); setEditAdId(null); setMsg(""); carregar(); } else setMsg(d.message || "Erro ao salvar adicional");
  };
  const removerAdicional = async (id) => {
    if (!confirm("Remover este adicional? Com histórico de compras ele será apenas desativado.")) return;
    const res = await fetch(`/api/assinatura/admin/adicionais/${id}`, { method: "DELETE", headers });
    const d = await res.json().catch(() => ({}));
    setMsg(d.message || "");
    if (res.ok) carregar();
  };
  const editarAdicional = (a) => { setEditAdId(a.id); setFormAd({ ...a, plano_minimo_id: a.plano_minimo_id ?? "", ativo: !!a.ativo }); };
  const campoAd = (k) => (e) => setFormAd({ ...formAd, [k]: e.target.value });

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
    setForm({ ...p, id: undefined, nome: `${p.nome} (cópia)`, max_equipamentos: p.max_equipamentos ?? "", max_admins: p.max_admins ?? "", max_portais: p.max_portais ?? "", inclui_whatsapp: !!p.inclui_whatsapp, inclui_campanhas: !!p.inclui_campanhas, inclui_exportacao: !!p.inclui_exportacao, inclui_dominio: !!p.inclui_dominio, gratis: !!p.gratis, trial_dias: p.trial_dias ?? "", exibir_site: itensDoPlano(p), ativo: false, ordem: (p.ordem ?? 0) + 1 });
  };
  const editar = (p) => { setCopiaDe(null); setEditId(p.id); setForm({ ...p, max_equipamentos: p.max_equipamentos ?? "", max_admins: p.max_admins ?? "", max_portais: p.max_portais ?? "", inclui_whatsapp: !!p.inclui_whatsapp, inclui_campanhas: !!p.inclui_campanhas, inclui_exportacao: !!p.inclui_exportacao, inclui_dominio: !!p.inclui_dominio, gratis: !!p.gratis, trial_dias: p.trial_dias ?? "", exibir_site: itensDoPlano(p), ativo: !!p.ativo }); };
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
                  <td className="px-5 py-3">R$ {Number(p.valor).toFixed(2)}{!!p.gratis && <span className="ml-2 text-xs text-green-400">Grátis</span>}</td>
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

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Adicionais</h2>
            <p className="text-sm text-gray-400 mt-1">Extras mensais que a empresa compra por cima do plano. Mantenha o avulso mais caro que subir de plano. Só equipamentos e administradores podem ficar ativos por enquanto.</p>
          </div>
          <button onClick={() => { setEditAdId(null); setFormAd(VAZIO_AD); }} className="px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-500 text-sm font-medium whitespace-nowrap">Novo adicional</button>
        </div>
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-5 py-3">Adicional</th><th className="text-left px-5 py-3">Tipo</th><th className="text-left px-5 py-3">Valor</th>
              <th className="text-left px-5 py-3">Soma</th><th className="text-left px-5 py-3">A partir de</th><th className="text-left px-5 py-3">Status</th><th className="px-5 py-3" />
            </tr></thead>
            <tbody>
              {adicionais.map((a) => (
                <tr key={a.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="px-5 py-3 text-white">{a.nome}</td>
                  <td className="px-5 py-3">{(TIPOS.find((t) => t[0] === a.tipo) || [a.tipo, a.tipo])[1]}</td>
                  <td className="px-5 py-3">R$ {Number(a.valor).toFixed(2)} / {a.ciclo_dias}d</td>
                  <td className="px-5 py-3">{TIPOS_ATIVOS.includes(a.tipo) ? `+${a.incremento}` : "—"}</td>
                  <td className="px-5 py-3">{a.plano_minimo_nome || "qualquer"}</td>
                  <td className="px-5 py-3">{a.ativo ? "Ativo" : "Inativo"}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => editarAdicional(a)} className="px-2.5 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs mr-2">Editar</button>
                    <button onClick={() => removerAdicional(a.id)} className="px-2.5 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs">Remover</button>
                  </td>
                </tr>
              ))}
              {adicionais.length === 0 && <tr><td colSpan="7" className="px-5 py-4 text-gray-500">Nenhum adicional. Rode a migration 041 ou crie um.</td></tr>}
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

        {formAd && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form onSubmit={salvarAdicional} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
              <h2 className="text-lg font-bold text-white">{editAdId ? "Editar adicional" : "Novo adicional"}</h2>
              {msg && <p className="text-sm text-red-300 bg-red-900/20 p-2 rounded">{msg}</p>}
              <div><label className="block text-sm text-gray-400 mb-1">Nome *</label><input required className={inputCls} value={formAd.nome} onChange={campoAd("nome")} /></div>
              <div><label className="block text-sm text-gray-400 mb-1">Descrição</label><input className={inputCls} value={formAd.descricao || ""} onChange={campoAd("descricao")} /></div>
              <div><label className="block text-sm text-gray-400 mb-1">Tipo</label>
                <select className={inputCls} value={formAd.tipo} onChange={campoAd("tipo")}>{TIPOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-gray-400 mb-1">Valor (R$) *</label><input required type="number" step="0.01" min="0" className={inputCls} value={formAd.valor} onChange={campoAd("valor")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Ciclo (dias)</label><input type="number" min="1" className={inputCls} value={formAd.ciclo_dias} onChange={campoAd("ciclo_dias")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Soma ao limite</label><input type="number" min="1" className={inputCls} value={formAd.incremento} onChange={campoAd("incremento")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Disponível a partir de</label>
                  <select className={inputCls} value={formAd.plano_minimo_id} onChange={campoAd("plano_minimo_id")}>
                    <option value="">Qualquer plano</option>{planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm text-gray-400 mb-1">Ordem</label><input type="number" className={inputCls} value={formAd.ordem} onChange={campoAd("ordem")} /></div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mt-6"><input type="checkbox" checked={formAd.ativo} onChange={(e) => setFormAd({ ...formAd, ativo: e.target.checked })} /> Ativo</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">Salvar</button>
                <button type="button" onClick={() => { setFormAd(null); setEditAdId(null); setMsg(""); }} className="flex-1 bg-gray-700 text-gray-300 py-2.5 rounded-lg text-sm">Cancelar</button>
              </div>
            </form>
          </div>
        )}

        <section className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 space-y-3" data-testid="donos-plataforma">
          <div>
            <h2 className="text-lg font-bold text-white">Donos da plataforma</h2>
            <p className="text-xs text-gray-500">Só quem tem este perfil vê Planos SaaS, Empresas, Atualizar/Backups e Logs do sistema. Vale apenas para super admins.</p>
          </div>
          {donos.length === 0 && <p className="text-sm text-gray-500">Nenhum super admin encontrado.</p>}
          <ul className="divide-y divide-gray-800">
            {donos.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{u.nome || u.email}</p>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.dono && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-800/30">Dono</span>}
                  <button type="button" onClick={() => alternarDono(u)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">
                    {u.dono ? "Remover perfil" : "Dar perfil de dono"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {form && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form onSubmit={salvarPlano} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h2 className="text-lg font-bold text-white">{editId ? "Editar plano" : copiaDe ? "Duplicar plano" : "Novo plano"}</h2>
              {copiaDe && <p className="text-xs text-gray-500">Cópia de "{copiaDe}". Ajuste e salve; nasce inativo.</p>}
              <div><label className="block text-sm text-gray-400 mb-1">Nome *</label><input required className={inputCls} value={form.nome} onChange={campo("nome")} /></div>
              <div><label className="block text-sm text-gray-400 mb-1">Descrição</label><input className={inputCls} value={form.descricao || ""} onChange={campo("descricao")} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-gray-400 mb-1">Valor (R$) *</label><input required type="number" step="0.01" min="0" disabled={!!form.gratis} className={inputCls} value={form.gratis ? 0 : form.valor} onChange={campo("valor")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Ciclo (dias)</label><input type="number" min="1" className={inputCls} value={form.ciclo_dias} onChange={campo("ciclo_dias")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Máx. equipamentos</label><input type="number" min="0" placeholder="ilimitado" className={inputCls} value={form.max_equipamentos} onChange={campo("max_equipamentos")} /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Máx. portais</label><input type="number" min="0" placeholder="ilimitado" className={inputCls} value={form.max_portais} onChange={campo("max_portais")} /></div>
                <label className="col-span-2 flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={!!form.gratis} onChange={(e) => setForm({ ...form, gratis: e.target.checked, valor: e.target.checked ? 0 : form.valor })} /> Plano grátis (nunca vence, sem cobrança)</label>
                <div className="col-span-2"><label className="block text-sm text-gray-400 mb-1">Dias de teste</label><input type="number" min="1" max="365" disabled={!!form.gratis} placeholder="padrão 7" className={inputCls} value={form.gratis ? "" : form.trial_dias} onChange={campo("trial_dias")} /></div>
                <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2" data-testid="recursos-plano">
                  <span className="w-full text-sm text-gray-400">Recursos incluídos</span>
                  {[["inclui_whatsapp", "WhatsApp"], ["inclui_campanhas", "Campanhas"], ["inclui_exportacao", "Exportação da base"], ["inclui_dominio", "Domínio próprio"]].map(([k, r]) => (
                    <label key={k} className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={!!form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {r}</label>
                  ))}
                </div>
                <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2" data-testid="exibir-site">
                  <span className="w-full text-sm text-gray-400">Mostrar no card do plano (site)</span>
                  {ITENS_SITE.map(([k, r]) => (
                    <label key={k} className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={(form.exibir_site || []).includes(k)} onChange={(e) => setForm({ ...form, exibir_site: e.target.checked ? [...(form.exibir_site || []), k] : (form.exibir_site || []).filter((x) => x !== k) })} /> {r}</label>
                  ))}
                </div>
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
