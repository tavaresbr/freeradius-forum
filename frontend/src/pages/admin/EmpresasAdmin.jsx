import React, { useState, useEffect, useCallback } from "react";
import CamposEmpresa, { CAMPOS_EMPRESA_VAZIOS, mascaraCnpj } from "../../components/CamposEmpresa";
import AdminLayout from "../../components/admin/AdminLayout";

const API = import.meta.env.VITE_API_URL || "";

export default function EmpresasAdmin() {
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS });
  const [erro, setErro] = useState(null);
  
  // Vinculação de admins
  const [showAdminsModal, setShowAdminsModal] = useState(null); // empresa_id
  const [adminsEmpresa, setAdminsEmpresa] = useState([]);
  const [todosAdmins, setTodosAdmins] = useState([]);
  const [vinculandoAdmin, setVinculandoAdmin] = useState({ admin_id: "", role: "operator" });
  const [uploadingLogo, setUploadingLogo] = useState(null);

  // Assinatura SaaS (modal do super admin)
  const [saasPlanos, setSaasPlanos] = useState([]);
  const [assinaturaModal, setAssinaturaModal] = useState(null); // empresa
  const [assForm, setAssForm] = useState({ plano_id: "", status: "ativa", estender_dias: "" });

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const handleLogoUpload = async (empresaId, file) => {
    if (!file) return;
    setUploadingLogo(empresaId);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch(`${API}/api/empresas/${empresaId}/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) fetchEmpresas();
      else alert('Erro ao enviar logo');
    } catch (err) {
      alert('Erro de conexão');
    } finally {
      setUploadingLogo(null);
    }
  };

  const fetchEmpresas = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/empresas`, { headers });
      if (res.ok) setEmpresas(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmpresas(); }, [fetchEmpresas]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro(null);
    try {
      const url = editId ? `${API}/api/empresas/${editId}` : `${API}/api/empresas`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (res.ok) {
        setShowModal(false);
        setEditId(null);
        setForm({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS });
        fetchEmpresas();
      } else {
        const data = await res.json();
        setErro(data.message || "Erro ao salvar");
      }
    } catch (err) {
      setErro("Erro de conexão");
    }
  };

  const handleEdit = (empresa) => {
    setEditId(empresa.id);
    setForm({
      nome: empresa.nome, cnpj: mascaraCnpj(empresa.cnpj || ""), email: empresa.email, telefone: empresa.telefone || "",
      ...Object.fromEntries(Object.keys(CAMPOS_EMPRESA_VAZIOS).map((k) => [k, empresa[k] || ""])),
    });
    setShowModal(true);
  };

  const handleDelete = async (id, slug) => {
    if (slug === 'default') return alert("Não é possível deletar a empresa padrão");
    if (!confirm("Deseja realmente deletar esta empresa? Todos os dados serão perdidos!")) return;
    await fetch(`${API}/api/empresas/${id}`, { method: "DELETE", headers });
    fetchEmpresas();
  };

  // --- Assinatura SaaS ---
  const abrirAssinatura = async (empresa) => {
    setAssinaturaModal(empresa);
    setAssForm({ plano_id: empresa.assinatura_plano_id || "", status: empresa.assinatura_status || "ativa", estender_dias: "" });
    const res = await fetch(`${API}/api/assinatura/admin/planos`, { headers });
    if (res.ok) setSaasPlanos(await res.json());
  };

  const salvarAssinatura = async (e) => {
    e.preventDefault();
    const body = { status: assForm.status };
    if (assForm.plano_id) body.plano_id = assForm.plano_id;
    if (assForm.estender_dias) body.estender_dias = assForm.estender_dias;
    const res = await fetch(`${API}/api/assinatura/admin/empresa/${assinaturaModal.id}`, { method: "PUT", headers, body: JSON.stringify(body) });
    if (res.ok) { setAssinaturaModal(null); fetchEmpresas(); } else alert("Erro ao salvar assinatura");
  };

  const badgeAssinatura = (e) => {
    const st = e.assinatura_status;
    if (!st) return <span className="px-2 py-0.5 rounded text-xs bg-red-900/30 text-red-400">Sem assinatura</span>;
    const fim = st === "trial" ? e.trial_ate : e.vence_em;
    const vencida = fim && new Date(fim) < new Date();
    const cor = st === "cancelada" || vencida || st === "vencida" ? "bg-red-900/30 text-red-400" : st === "trial" ? "bg-blue-900/30 text-blue-300" : "bg-green-900/30 text-green-400";
    const rotulo = vencida && st !== "cancelada" ? "vencida" : st;
    return (
      <div>
        <span className={`px-2 py-0.5 rounded text-xs ${cor}`}>{rotulo}</span>
        <p className="text-[11px] text-gray-500 mt-1">{e.assinatura_plano_nome || "—"}{fim ? ` · ${new Date(fim).toLocaleDateString("pt-BR")}` : ""}</p>
      </div>
    );
  };

  // --- Admin vinculation ---
  const openAdminsModal = async (empresaId) => {
    setShowAdminsModal(empresaId);
    const [adminsRes, todosRes] = await Promise.all([
      fetch(`${API}/api/empresas/${empresaId}/admins`, { headers }),
      fetch(`${API}/api/empresas/admins/todos`, { headers }),
    ]);
    setAdminsEmpresa(await adminsRes.json());
    setTodosAdmins(await todosRes.json());
  };

  const vincularAdmin = async () => {
    if (!vinculandoAdmin.admin_id) return;
    await fetch(`${API}/api/empresas/${showAdminsModal}/vincular-admin`, {
      method: "POST", headers, body: JSON.stringify(vinculandoAdmin)
    });
    setVinculandoAdmin({ admin_id: "", role: "operator" });
    openAdminsModal(showAdminsModal);
  };

  const desvincularAdmin = async (adminId) => {
    if (!confirm("Remover este admin da empresa?")) return;
    await fetch(`${API}/api/empresas/${showAdminsModal}/desvincular-admin/${adminId}`, {
      method: "DELETE", headers
    });
    openAdminsModal(showAdminsModal);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Empresas</h1>
            <p className="text-sm text-gray-400 mt-1">{empresas.length} empresa(s) cadastrada(s)</p>
          </div>
          <button
            onClick={() => { setEditId(null); setForm({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS }); setErro(null); setShowModal(true); }}
            className="px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-500 text-sm font-medium flex items-center gap-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
            </svg>
            Nova Empresa
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-gray-500 text-center py-10">Carregando...</p>
        ) : (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-5 py-3 font-medium w-12">Logo</th>
                  <th className="text-left px-5 py-3 font-medium">Empresa</th>
                  <th className="text-left px-5 py-3 font-medium">CNPJ</th>
                  <th className="text-left px-5 py-3 font-medium">Contato</th>
                  <th className="text-center px-5 py-3 font-medium">Stats</th>
                  <th className="text-center px-5 py-3 font-medium">Status</th>
                  <th className="text-center px-5 py-3 font-medium">Assinatura</th>
                  <th className="text-right px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <label className="cursor-pointer block w-10 h-10 rounded-lg overflow-hidden bg-gray-800 border border-gray-700 hover:border-blue-500 transition-colors relative">
                        {e.logo_url ? (
                          <img src={e.logo_url} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <div className="flex items-center justify-center h-full text-gray-500 text-xs">📷</div>
                        )}
                        <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo === e.id}
                          onChange={(ev) => handleLogoUpload(e.id, ev.target.files[0])} />
                        {uploadingLogo === e.id && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><span className="text-[10px] text-white">...</span></div>}
                      </label>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{e.nome}</p>
                      <p className="text-xs text-gray-500">/{e.slug}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-400">{e.cnpj || "—"}</td>
                    <td className="px-5 py-4">
                      <p className="text-gray-300 text-xs">{e.email}</p>
                      {e.telefone && <p className="text-gray-500 text-xs">{e.telefone}</p>}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex gap-3 justify-center text-xs">
                        <span className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded">{e.total_mikrotiks || 0} MKT</span>
                        <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded">{e.total_planos || 0} Planos</span>
                        <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">{e.total_admins || 0} Admins</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${e.ativo ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                        {e.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">{badgeAssinatura(e)}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => abrirAssinatura(e)} className="px-2.5 py-1.5 bg-green-600/20 text-green-400 rounded-lg text-xs hover:bg-green-600/30 transition-colors" title="Gerenciar assinatura">
                          Assinatura
                        </button>
                        <button onClick={() => openAdminsModal(e.id)} className="px-2.5 py-1.5 bg-cyan-600/20 text-cyan-400 rounded-lg text-xs hover:bg-cyan-600/30 transition-colors" title="Gerenciar Admins">
                          👥
                        </button>
                        <button onClick={() => handleEdit(e)} className="px-2.5 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs hover:bg-yellow-600/30 transition-colors">
                          Editar
                        </button>
                        {e.slug !== 'default' && (
                          <button onClick={() => handleDelete(e.id, e.slug)} className="px-2.5 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs hover:bg-red-600/30 transition-colors">
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal Criar/Editar Empresa */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <form onSubmit={handleSubmit} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold text-white mb-4">
                {editId ? "Editar Empresa" : "Nova Empresa"}
              </h2>
              {erro && <p className="text-red-400 text-sm mb-3 bg-red-900/20 p-2 rounded">{erro}</p>}
              <div className="space-y-3">
                <CamposEmpresa
                  form={form}
                  setForm={setForm}
                  labelClass="block text-sm text-gray-400 mb-1"
                  inputClass="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                />
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Nome *</label>
                  <input type="text" required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email *</label>
                  <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Telefone</label>
                  <input type="text" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-500 text-sm font-medium">
                  {editId ? "Salvar" : "Criar"}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-700 text-gray-300 py-2.5 rounded-lg hover:bg-gray-600 text-sm">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Modal Assinatura SaaS */}
        {assinaturaModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <form onSubmit={salvarAssinatura} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-md">
              <h2 className="text-lg font-bold text-white mb-4">Assinatura – {assinaturaModal.nome}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Plano</label>
                  <select value={assForm.plano_id} onChange={(e) => setAssForm({ ...assForm, plano_id: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
                    <option value="">Manter atual</option>
                    {saasPlanos.map((p) => <option key={p.id} value={p.id}>{p.nome} – R$ {Number(p.valor).toFixed(2)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Status</label>
                  <select value={assForm.status} onChange={(e) => setAssForm({ ...assForm, status: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
                    <option value="trial">Teste (trial)</option>
                    <option value="ativa">Ativa</option>
                    <option value="vencida">Vencida</option>
                    <option value="cancelada">Cancelada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Estender por (dias)</label>
                  <input type="number" min="0" value={assForm.estender_dias} onChange={(e) => setAssForm({ ...assForm, estender_dias: e.target.value })}
                    placeholder="Ex.: 30 (soma ao vencimento atual)" className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-500 text-sm font-medium">Salvar</button>
                <button type="button" onClick={() => setAssinaturaModal(null)} className="flex-1 bg-gray-700 text-gray-300 py-2.5 rounded-lg hover:bg-gray-600 text-sm">Cancelar</button>
              </div>
            </form>
          </div>
        )}

        {/* Modal Admins da Empresa */}
        {showAdminsModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">Admins Vinculados</h2>
                <button onClick={() => setShowAdminsModal(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              {/* Lista de admins vinculados */}
              <div className="space-y-2 mb-6">
                {adminsEmpresa.length === 0 && <p className="text-gray-500 text-sm">Nenhum admin vinculado</p>}
                {adminsEmpresa.map(a => (
                  <div key={a.id} className="flex items-center justify-between bg-[#0d1117] rounded-lg px-4 py-3">
                    <div>
                      <p className="text-white text-sm font-medium">{a.nome || a.email}</p>
                      <p className="text-gray-500 text-xs">{a.email} · <span className="text-blue-400">{a.role_empresa}</span></p>
                    </div>
                    <button onClick={() => desvincularAdmin(a.id)}
                      className="px-2 py-1 bg-red-600/20 text-red-400 rounded text-xs hover:bg-red-600/30">
                      Remover
                    </button>
                  </div>
                ))}
              </div>

              {/* Vincular novo admin */}
              <div className="border-t border-gray-800 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Vincular Admin</h3>
                <div className="flex gap-2">
                  <select value={vinculandoAdmin.admin_id}
                    onChange={(e) => setVinculandoAdmin({ ...vinculandoAdmin, admin_id: e.target.value })}
                    className="flex-1 bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
                    <option value="">Selecione um admin...</option>
                    {todosAdmins.filter(a => !adminsEmpresa.find(ae => ae.id === a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.nome || a.email} ({a.role})</option>
                    ))}
                  </select>
                  <select value={vinculandoAdmin.role}
                    onChange={(e) => setVinculandoAdmin({ ...vinculandoAdmin, role: e.target.value })}
                    className="bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm w-28">
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="operator">Operator</option>
                  </select>
                  <button onClick={vincularAdmin}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm font-medium">
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
