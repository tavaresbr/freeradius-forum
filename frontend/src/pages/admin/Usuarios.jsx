import React, { useEffect, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ email: "", senha: "", nome: "", perfil: "padrao" });
  const [editando, setEditando] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const token = localStorage.getItem("admin_token");

  const carregarUsuarios = async () => {
    try {
      const res = await fetch("/api/admins", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      setUsuarios(res.ok && Array.isArray(data) ? data : []);
      if (!res.ok) setErro((data && (data.message || data.error)) || "Erro ao carregar usuários");
    } catch (err) {
      console.error("Erro ao carregar admins:", err);
    }
  };

  const carregarPerfis = async () => {
    try {
      const res = await fetch("/api/admins/perfis", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data)) setPerfis(data);
    } catch (err) {
      console.error("Erro ao carregar perfis:", err);
    }
  };

  useEffect(() => {
    carregarUsuarios();
    carregarPerfis();
  }, []);

  // Primeiro usuario da empresa e' sempre Administrador (o servidor tambem forca).
  const primeiroUsuario = usuarios.length === 0 && !editando;
  const rotuloPerfil = (chave) => (perfis.find((p) => p.chave === chave) || {}).nome || "—";
  const descricaoPerfil = (perfis.find((p) => p.chave === (primeiroUsuario ? "administrador" : form.perfil)) || {}).descricao;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editando ? `/api/admins/${editando}` : "/api/admins";
      const method = editando ? "PUT" : "POST";

      const payload = { email: form.email, nome: form.nome || null };
      if (!editando || form.senha) payload.senha = form.senha;
      if (primeiroUsuario) payload.perfil = "administrador";
      else if (form.perfil) payload.perfil = form.perfil;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.message || data.error || "Erro ao salvar usuário");
        return;
      }

      setShowModal(false);
      setEditando(null);
      setErro("");
      setForm({ email: "", senha: "", nome: "", perfil: "padrao" });
      carregarUsuarios();
    } catch (err) {
      setErro("Erro de conexão com o servidor");
    }
  };

  const handleEditar = (admin) => {
    setEditando(admin.id);
    setErro("");
    setForm({ email: admin.email, senha: "", nome: admin.nome || "", perfil: admin.perfil || "" });
    setShowModal(true);
  };

  const handleRemover = async (id) => {
    if (!confirm("Deseja remover este administrador?")) return;
    try {
      const res = await fetch(`/api/admins/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.message || data.error || "Erro ao remover usuário");
        return;
      }
      setErro("");
      carregarUsuarios();
    } catch (err) {
      setErro("Erro ao remover usuário");
    }
  };

  return (
    <AdminLayout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Administradores</h1>
        <button
          onClick={() => {
            setEditando(null);
            setErro("");
            setForm({ email: "", senha: "", nome: "", perfil: "padrao" });
            setShowModal(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          + Novo Admin
        </button>
      </div>

      {erro && !showModal && <p className="text-red-400 text-sm mb-4">{erro}</p>}

      <div className="bg-[#1a1d27] rounded border border-gray-800 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-800">
              <th className="p-2">ID</th>
              <th className="p-2">Nome</th>
              <th className="p-2">Email</th>
              <th className="p-2">Perfil</th>
              <th className="p-2">Criado</th>
              <th className="p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((a) => (
              <tr key={a.id} className="border-b hover:bg-[#151821]">
                <td className="p-2">{a.id}</td>
                <td className="p-2">{a.nome || "—"}</td>
                <td className="p-2">{a.email}</td>
                <td className="p-2">{rotuloPerfil(a.perfil)}</td>
                <td className="p-2">{new Date(a.created_at).toLocaleString()}</td>
                <td className="p-2 flex gap-2">
                  <button
                    onClick={() => handleEditar(a)}
                    className="border border-gray-700 text-gray-300 px-2 py-1 rounded hover:bg-[#252b3b]"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleRemover(a.id)}
                    className="bg-red-500 text-white px-2 py-1 rounded"
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a1d27] rounded p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">
              {editando ? "Editar Admin" : "Criar Admin"}
            </h2>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {erro && <p className="text-red-400 text-sm">{erro}</p>}
              <div>
                <label className="block text-sm mb-1">Nome</label>
                <input
                  type="text"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Email</label>
                <input
                  type="email"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">
                  Senha {editando && <span className="text-gray-400">(deixe em branco para manter)</span>}
                </label>
                <input
                  type="password"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Perfil</label>
                <select
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500 disabled:opacity-60"
                  value={primeiroUsuario ? "administrador" : form.perfil}
                  disabled={primeiroUsuario}
                  onChange={(e) => setForm({ ...form, perfil: e.target.value })}
                >
                  {editando && !form.perfil && <option value="">Sem perfil do sistema (manter)</option>}
                  {perfis.map((p) => (
                    <option key={p.chave} value={p.chave}>{p.nome}</option>
                  ))}
                </select>
                {descricaoPerfil && <p className="text-xs text-gray-400 mt-1">{descricaoPerfil}</p>}
                {primeiroUsuario && (
                  <p className="text-xs text-yellow-400 mt-1">O primeiro usuário da empresa é sempre Administrador.</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setErro(""); }}
                  className="px-4 py-2 rounded border"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-blue-600 text-white"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
