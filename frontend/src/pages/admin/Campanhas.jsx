import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Campanhas() {
  const { empresaSlug } = useParams();
  const [campanhas, setCampanhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ nome: "", descricao: "" });
  const [salvando, setSalvando] = useState(false);
  const token = localStorage.getItem("admin_token");

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/campanhas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar campanhas");
      setCampanhas(data.data || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const handleCriar = async (e) => {
    e.preventDefault();
    if (!form.nome.trim()) return alert("Informe o nome da campanha.");
    setSalvando(true);
    try {
      const res = await fetch("/api/campanhas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nome: form.nome, descricao: form.descricao }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar campanha");
      setShowModal(false);
      setForm({ nome: "", descricao: "" });
      carregar();
    } catch (err) {
      alert(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const handleToggleAtivo = async (c) => {
    try {
      const res = await fetch(`/api/campanhas/${c.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ativo: !c.ativo }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar campanha");
      carregar();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeletar = async (c) => {
    if (!confirm(`Deseja realmente excluir a campanha "${c.nome}"?`)) return;
    const excluir = (forcar) =>
      fetch(`/api/campanhas/${c.id}${forcar ? "?forcar=1" : ""}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    try {
      let res = await excluir(false);
      // Em uso por portal: o servidor avisa (409) e so exclui com confirmacao
      if (res.status === 409) {
        const info = await res.json().catch(() => ({}));
        const nomes = (info.em_uso || []).map((p) => p.nome).join(", ");
        if (!confirm(`Esta campanha está em uso pelo portal: ${nomes}.\nSe excluir, ele fica sem pré-portal. Excluir mesmo assim?`)) return;
        res = await excluir(true);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao excluir campanha");
      }
      carregar();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <AdminLayout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Campanhas</h1>
        <button
          onClick={() => {
            setForm({ nome: "", descricao: "" });
            setShowModal(true);
          }}
          className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-neutral-800"
        >
          + Nova Campanha
        </button>
      </div>

      <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Campanhas Cadastradas</h2>
        {loading ? (
          <p className="text-gray-400">Carregando...</p>
        ) : campanhas.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhuma campanha cadastrada.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-gray-500 border-b border-gray-800">
              <tr>
                <th className="p-2">Nome</th>
                <th className="p-2">Descrição</th>
                <th className="p-2">Itens</th>
                <th className="p-2">Views</th>
                <th className="p-2">Em uso em</th>
                <th className="p-2">Status</th>
                <th className="p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-[#151821]">
                  <td className="p-2 font-semibold text-white">{c.nome}</td>
                  <td className="p-2 text-gray-400 text-xs max-w-xs truncate">{c.descricao || "—"}</td>
                  <td className="p-2 text-gray-300">{c.total_itens ?? 0}</td>
                  <td className="p-2 text-gray-300">{c.views ?? 0}</td>
                  <td className="p-2 text-gray-400 text-xs max-w-[10rem] truncate" title={c.portais_em_uso || ""}>
                    {c.portais_em_uso || "—"}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => handleToggleAtivo(c)}
                      className={`text-xs px-2 py-1 rounded-full cursor-pointer ${
                        c.ativo
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400"
                      }`}
                      title="Clique para alternar"
                    >
                      {c.ativo ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <Link
                        to={`/admin/${empresaSlug}/campanhas/${c.id}`}
                        className="border border-gray-700 text-gray-300 px-2 py-1 rounded hover:bg-[#252b3b] text-xs"
                      >
                        Editar
                      </Link>
                      <button
                        onClick={() => handleDeletar(c)}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1a1d27] rounded-xl border border-gray-700 w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Nova Campanha</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-gray-300 text-xl"
              >
                ×
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleCriar}>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Nome <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Descrição</label>
                <textarea
                  className="w-full bg-[#0d1117] border border-gray-700 text-white px-3 py-2 rounded focus:outline-none focus:border-blue-500"
                  rows={3}
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-700 text-gray-300 rounded hover:bg-[#151821]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-neutral-800 disabled:opacity-50"
                >
                  {salvando ? "Criando..." : "Criar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
