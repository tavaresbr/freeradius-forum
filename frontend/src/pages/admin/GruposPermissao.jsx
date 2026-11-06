import React, { useState, useEffect, useCallback } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

const API = import.meta.env.VITE_API_URL || "";

const MODULOS_LABELS = {
  dashboard: "Dashboard",
  mikrotiks: "Mikrotiks",
  vpn: "VPN WireGuard",
  portais: "Portais",
  planos: "Planos",
  clientes: "Clientes (LGPD)",
  leads: "Leads",
  radius: "Usuários RADIUS",
  pagamentos: "Pagamentos",
  sessoes: "Sessões Ativas",
  sessoeslog: "Log Radius",
  compliance: "Marco Civil",
  configuracoes: "Configurações",
  usuarios: "Usuários",
};

const ACOES = ["ver", "criar", "editar", "excluir"];
const ACOES_LABELS = { ver: "Ver", criar: "Criar", editar: "Editar", excluir: "Excluir" };

function emptyPermissoes() {
  return Object.keys(MODULOS_LABELS).map((m) => ({
    modulo: m,
    ver: false,
    criar: false,
    editar: false,
    excluir: false,
  }));
}

export default function GruposPermissao() {
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nome: "", descricao: "", permissoes: emptyPermissoes() });
  const [erro, setErro] = useState(null);

  // Admins modal
  const [showAdminsModal, setShowAdminsModal] = useState(null);
  const [adminsGrupo, setAdminsGrupo] = useState([]);
  const [todosAdmins, setTodosAdmins] = useState([]);
  const [adminSelecionado, setAdminSelecionado] = useState("");

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchGrupos = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/grupos-permissao`, { headers });
      if (res.ok) setGrupos(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGrupos(); }, [fetchGrupos]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro(null);
    try {
      const url = editId ? `${API}/api/grupos-permissao/${editId}` : `${API}/api/grupos-permissao`;
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (res.ok) {
        setShowModal(false);
        setEditId(null);
        setForm({ nome: "", descricao: "", permissoes: emptyPermissoes() });
        fetchGrupos();
      } else {
        const data = await res.json();
        setErro(data.message || "Erro ao salvar");
      }
    } catch (err) {
      setErro("Erro de conexão");
    }
  };

  const handleEdit = async (grupo) => {
    try {
      const res = await fetch(`${API}/api/grupos-permissao/${grupo.id}`, { headers });
      const data = await res.json();
      const perms = emptyPermissoes().map((p) => {
        const found = data.permissoes?.find((dp) => dp.modulo === p.modulo);
        return found ? { ...p, ver: !!found.ver, criar: !!found.criar, editar: !!found.editar, excluir: !!found.excluir } : p;
      });
      setEditId(grupo.id);
      setForm({ nome: data.nome, descricao: data.descricao || "", permissoes: perms });
      setShowModal(true);
    } catch (err) {
      alert("Erro ao carregar grupo");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Deletar este grupo de permissão?")) return;
    await fetch(`${API}/api/grupos-permissao/${id}`, { method: "DELETE", headers });
    fetchGrupos();
  };

  const togglePerm = (modulo, acao) => {
    setForm((prev) => ({
      ...prev,
      permissoes: prev.permissoes.map((p) =>
        p.modulo === modulo ? { ...p, [acao]: !p[acao] } : p
      ),
    }));
  };

  const toggleAllModulo = (modulo) => {
    const perm = form.permissoes.find((p) => p.modulo === modulo);
    const allChecked = ACOES.every((a) => perm[a]);
    setForm((prev) => ({
      ...prev,
      permissoes: prev.permissoes.map((p) =>
        p.modulo === modulo ? { ...p, ver: !allChecked, criar: !allChecked, editar: !allChecked, excluir: !allChecked } : p
      ),
    }));
  };

  const toggleAllAcao = (acao) => {
    const allChecked = form.permissoes.every((p) => p[acao]);
    setForm((prev) => ({
      ...prev,
      permissoes: prev.permissoes.map((p) => ({ ...p, [acao]: !allChecked })),
    }));
  };

  // Admins
  const openAdminsModal = async (grupoId) => {
    setShowAdminsModal(grupoId);
    const [admRes, todosRes] = await Promise.all([
      fetch(`${API}/api/grupos-permissao/${grupoId}/admins`, { headers }),
      fetch(`${API}/api/grupos-permissao/admins/todos`, { headers }),
    ]);
    setAdminsGrupo(await admRes.json());
    setTodosAdmins(await todosRes.json());
  };

  const vincularAdmin = async () => {
    if (!adminSelecionado) return;
    await fetch(`${API}/api/grupos-permissao/${showAdminsModal}/vincular-admin`, {
      method: "POST", headers, body: JSON.stringify({ admin_id: adminSelecionado })
    });
    setAdminSelecionado("");
    openAdminsModal(showAdminsModal);
  };

  const desvincularAdmin = async (adminId) => {
    if (!confirm("Remover este admin do grupo?")) return;
    await fetch(`${API}/api/grupos-permissao/${showAdminsModal}/desvincular-admin/${adminId}`, { method: "DELETE", headers });
    openAdminsModal(showAdminsModal);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Grupos de Permissão</h1>
            <p className="text-sm text-gray-400 mt-1">{grupos.length} grupo(s) cadastrado(s)</p>
          </div>
          <button
            onClick={() => { setEditId(null); setForm({ nome: "", descricao: "", permissoes: emptyPermissoes() }); setErro(null); setShowModal(true); }}
            className="px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-500 text-sm font-medium flex items-center gap-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
            </svg>
            Novo Grupo
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
                  <th className="text-left px-5 py-3 font-medium">Nome</th>
                  <th className="text-left px-5 py-3 font-medium">Descrição</th>
                  <th className="text-center px-5 py-3 font-medium">Admins</th>
                  <th className="text-right px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={g.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{g.nome}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-400 text-xs">{g.descricao || "—"}</td>
                    <td className="px-5 py-4 text-center">
                      <span className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs">{g.total_admins || 0}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openAdminsModal(g.id)} className="px-2.5 py-1.5 bg-cyan-600/20 text-cyan-400 rounded-lg text-xs hover:bg-cyan-600/30">👥</button>
                        <button onClick={() => handleEdit(g)} className="px-2.5 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs hover:bg-yellow-600/30">Editar</button>
                        <button onClick={() => handleDelete(g.id)} className="px-2.5 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs hover:bg-red-600/30">Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal Criar/Editar */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <form onSubmit={handleSubmit} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold text-white mb-4">
                {editId ? "Editar Grupo" : "Novo Grupo de Permissão"}
              </h2>
              {erro && <p className="text-red-400 text-sm mb-3 bg-red-900/20 p-2 rounded">{erro}</p>}

              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Nome *</label>
                  <input type="text" required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Descrição</label>
                  <input type="text" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Grid de Permissões */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Permissões por Módulo</h3>
                <div className="bg-[#0d1117] border border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-400">
                        <th className="text-left px-3 py-2 font-medium">Módulo</th>
                        {ACOES.map((a) => (
                          <th key={a} className="text-center px-2 py-2 font-medium cursor-pointer hover:text-white" onClick={() => toggleAllAcao(a)}>
                            {ACOES_LABELS[a]}
                          </th>
                        ))}
                        <th className="text-center px-2 py-2 font-medium text-gray-500">Todos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.permissoes.map((p) => (
                        <tr key={p.modulo} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                          <td className="px-3 py-2 text-gray-300 font-medium">{MODULOS_LABELS[p.modulo]}</td>
                          {ACOES.map((a) => (
                            <td key={a} className="text-center px-2 py-2">
                              <input
                                type="checkbox"
                                checked={p[a]}
                                onChange={() => togglePerm(p.modulo, a)}
                                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>
                          ))}
                          <td className="text-center px-2 py-2">
                            <button type="button" onClick={() => toggleAllModulo(p.modulo)}
                              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                                ACOES.every((a) => p[a])
                                  ? "bg-green-600/30 text-green-400 hover:bg-green-600/50"
                                  : "bg-gray-700/50 text-gray-500 hover:bg-gray-700"
                              }`}>
                              {ACOES.every((a) => p[a]) ? "✓" : "—"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-3">
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

        {/* Modal Admins do Grupo */}
        {showAdminsModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">Admins do Grupo</h2>
                <button onClick={() => setShowAdminsModal(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <div className="space-y-2 mb-6">
                {adminsGrupo.length === 0 && <p className="text-gray-500 text-sm">Nenhum admin vinculado</p>}
                {adminsGrupo.map((a) => (
                  <div key={a.id} className="flex items-center justify-between bg-[#0d1117] rounded-lg px-4 py-3">
                    <div>
                      <p className="text-white text-sm font-medium dado-sensivel">{a.nome || a.email}</p>
                      <p className="text-gray-500 text-xs dado-sensivel">{a.email} · <span className="text-blue-400">{a.role}</span></p>
                    </div>
                    <button onClick={() => desvincularAdmin(a.id)}
                      className="px-2 py-1 bg-red-600/20 text-red-400 rounded text-xs hover:bg-red-600/30">
                      Remover
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-800 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Vincular Admin</h3>
                <div className="flex gap-2">
                  <select value={adminSelecionado}
                    onChange={(e) => setAdminSelecionado(e.target.value)}
                    className="flex-1 bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
                    <option value="">Selecione um admin...</option>
                    {todosAdmins.filter((a) => !adminsGrupo.find((ag) => ag.id === a.id)).map((a) => (
                      <option key={a.id} value={a.id}>{a.nome || a.email} ({a.role})</option>
                    ))}
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
