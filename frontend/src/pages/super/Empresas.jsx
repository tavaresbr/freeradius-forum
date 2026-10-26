import { useState, useEffect } from "react";
import CamposEmpresa, { CAMPOS_EMPRESA_VAZIOS, mascaraCnpj, mascaraCpf } from "../../components/CamposEmpresa";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function Empresas() {
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS });

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate("/admin");
      return;
    }
    fetchEmpresas();
  }, []);

  const fetchEmpresas = async () => {
    try {
      const res = await fetch("/api/empresas", { headers });
      if (res.ok) setEmpresas(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editId ? `/api/empresas/${editId}` : "/api/empresas";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (res.ok) {
        setShowModal(false);
        setEditId(null);
        setForm({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS });
        fetchEmpresas();
      }
    } catch (err) {
      console.error(err);
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

  const handleDelete = async (id) => {
    if (!confirm("Deseja realmente deletar esta empresa?")) return;
    try {
      await fetch(`/api/empresas/${id}`, { method: "DELETE", headers });
      fetchEmpresas();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f111a] text-gray-300 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link to="/super" className="text-gray-500 hover:text-gray-300 text-sm mb-2 inline-block">
              &larr; Voltar ao Super Admin
            </Link>
            <h1 className="text-2xl font-bold text-white">Gerenciar Empresas</h1>
          </div>
          <button
            onClick={() => { setEditId(null); setForm({ nome: "", cnpj: "", email: "", telefone: "", ...CAMPOS_EMPRESA_VAZIOS }); setShowModal(true); }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm"
          >
            Nova Empresa
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">Carregando...</p>
        ) : (
          <div className="space-y-3">
            {empresas.map((e) => (
              <div key={e.id} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{e.nome}</p>
                  <p className="text-sm text-gray-500">{e.email} | slug: {e.slug} {e.cnpj && `| CNPJ: ${e.cnpj}`}{e.tipo_pessoa === "PF" && e.cpf && `| CPF: ${mascaraCpf(e.cpf)}`}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {e.total_mikrotiks || 0} mikrotiks | {e.total_planos || 0} planos | {e.total_admins || 0} admins
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/admin/${e.slug}`}
                    className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded text-sm hover:bg-blue-600/30"
                  >
                    Acessar
                  </Link>
                  <button
                    onClick={() => handleEdit(e)}
                    className="px-3 py-1.5 bg-yellow-600/20 text-yellow-400 rounded text-sm hover:bg-yellow-600/30"
                  >
                    Editar
                  </button>
                  {e.slug !== 'default' && (
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded text-sm hover:bg-red-600/30"
                    >
                      Deletar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <form onSubmit={handleSubmit} className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold text-white mb-4">
                {editId ? "Editar Empresa" : "Nova Empresa"}
              </h2>

              <div className="space-y-3">
                <CamposEmpresa
                  form={form}
                  setForm={setForm}
                  labelClass="block text-sm text-gray-400 mb-1"
                  inputClass="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm"
                />
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Nome</label>
                  <input
                    type="text" required
                    value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input
                    type="email" required
                    value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                    className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-500 text-sm">
                  {editId ? "Salvar" : "Criar"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg hover:bg-gray-600 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
