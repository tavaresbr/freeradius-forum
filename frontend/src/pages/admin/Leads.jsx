import React, { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { mascaraCPF } from "../../utils/cpfUtils";
import { mascaraData, mascaraTelefone } from "../../utils/dataUtils";

const API = "";

const statusColors = {
  novo: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  contactado: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50",
  convertido: "bg-green-900/40 text-green-400 border-green-800/50",
  descartado: "bg-red-900/40 text-red-400 border-red-800/50",
};

const statusLabels = {
  novo: "Novo",
  contactado: "Contactado",
  convertido: "Convertido",
  descartado: "Descartado",
};

const tabs = [
  { key: "todos", label: "Todos" },
  { key: "novo", label: "Novo" },
  { key: "contactado", label: "Contactado" },
  { key: "convertido", label: "Convertido" },
  { key: "descartado", label: "Descartado" },
];

const FORM_VAZIO = {
  tipo_pessoa: "PF", nome: "", razao_social: "", cpf: "", cnpj: "", rg: "", data_nascimento: "",
  email: "", telefone: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  id_externo: "", status: "novo", observacoes: "",
};

const abasForm = [
  { key: "dados", label: "Dados" },
  { key: "endereco", label: "Endereço" },
  { key: "outros", label: "Outros" },
];

const inputCls = "w-full px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-gray-200 focus:outline-none focus:border-blue-800 text-sm";

// ISO ('1985-04-01...') -> 'DD/MM/AAAA'
const isoParaBr = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const deLead = (l) => {
  const f = { ...FORM_VAZIO };
  Object.keys(FORM_VAZIO).forEach((k) => { if (l[k] != null) f[k] = l[k]; });
  f.data_nascimento = isoParaBr(l.data_nascimento);
  f.cpf = l.cpf ? mascaraCPF(l.cpf) : "";
  return f;
};

function Campo({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function Leads() {
  const { empresaSlug } = useParams();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [aba, setAba] = useState("dados");
  const [form, setForm] = useState(FORM_VAZIO);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const token = localStorage.getItem("admin_token");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const fetchLeads = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "todos") params.append("status", statusFilter);
      if (search) params.append("q", search);

      const res = await fetch(`${API}/api/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Erro ao buscar clientes:", err);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, search]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await fetch(`${API}/api/leads/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchLeads();
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Tem certeza que deseja excluir este cadastro?")) return;
    try {
      await fetch(`${API}/api/leads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchLeads();
    } catch (err) {
      console.error("Erro ao deletar cadastro:", err);
    }
  };

  const abrirNovo = () => {
    setEditId(null);
    setForm(FORM_VAZIO);
    setAba("dados");
    setErro("");
    setShowModal(true);
  };

  const abrirEdicao = (lead) => {
    setEditId(lead.id);
    setForm(deLead(lead));
    setAba("dados");
    setErro("");
    setShowModal(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const corpo = { ...form };
      if (editId === null) corpo.origem = "manual";
      const res = await fetch(`${API}/api/leads${editId === null ? "" : `/${editId}`}`, {
        method: editId === null ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.message || "Não foi possível salvar");
        return;
      }
      setShowModal(false);
      fetchLeads();
    } catch (err) {
      console.error("Erro ao salvar cadastro:", err);
      setErro("Erro de conexão ao salvar");
    } finally {
      setSalvando(false);
    }
  };

  const handleExport = async () => {
    try {
      const r = await fetch(`${API}/api/auth/download-token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("token");
      const { token: dl } = await r.json();
      window.open(`${API}/api/leads/export?token=${dl}`, "_blank");
    } catch (err) {
      console.error("Erro ao exportar leads:", err);
      alert("Nao foi possivel exportar. Faca login novamente.");
    }
  };

  const formatDate = (d) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const doc = (l) => (l.cpf ? mascaraCPF(l.cpf) : l.cnpj || "-");

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Clientes</h1>
            <p className="text-gray-400 text-sm mt-1">Cadastro completo de clientes e leads</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link
              to={`/admin/${empresaSlug}/importar-clientes`}
              className="px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm"
            >
              Importar (SGP / planilha)
            </Link>
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-[#1a1d27] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm cursor-pointer"
            >
              Exportar CSV
            </button>
            <button
              onClick={abrirNovo}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer"
            >
              + Novo Cliente
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                statusFilter === tab.key
                  ? "bg-blue-900/30 text-blue-400 border border-blue-800/50"
                  : "bg-[#1a1d27] text-gray-400 border border-gray-800 hover:bg-[#252b3b]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar por nome, email, CPF, telefone ou ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-96 px-4 py-2 pl-10 bg-[#1a1d27] border border-gray-800 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-800 text-sm"
          />
          <svg
            className="absolute left-3 top-2.5 w-4 h-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Table */}
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Nome</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium hidden md:table-cell">Telefone</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium hidden lg:table-cell">CPF/CNPJ</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium hidden xl:table-cell">Cidade</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium hidden md:table-cell">Origem</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium hidden lg:table-cell">Data</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9" className="text-center py-8 text-gray-500">
                      Carregando...
                    </td>
                  </tr>
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="text-center py-8 text-gray-500">
                      Nenhum cadastro encontrado
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-[#252b3b]/30">
                      <td className="px-4 py-3 text-gray-200">{lead.nome || "-"}</td>
                      <td className="px-4 py-3 text-gray-400">{lead.email || "-"}</td>
                      <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{lead.telefone || "-"}</td>
                      <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{doc(lead)}</td>
                      <td className="px-4 py-3 text-gray-400 hidden xl:table-cell">
                        {lead.cidade ? `${lead.cidade}${lead.uf ? `/${lead.uf}` : ""}` : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                          className={`px-2 py-1 rounded-md text-xs font-medium border cursor-pointer bg-transparent ${statusColors[lead.status]}`}
                        >
                          {Object.entries(statusLabels).map(([val, label]) => (
                            <option key={val} value={val} className="bg-[#1a1d27] text-gray-300">
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-gray-400 hidden md:table-cell capitalize">
                        {lead.sistema_origem || lead.origem}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{formatDate(lead.criado_em)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => abrirEdicao(lead)}
                          className="text-blue-400 hover:text-blue-300 text-xs cursor-pointer mr-3"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(lead.id)}
                          className="text-red-400 hover:text-red-300 text-xs cursor-pointer"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Cadastro */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-800">
              <h2 className="text-lg font-bold text-white">{editId === null ? "Novo Cliente" : "Editar Cliente"}</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-200 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex gap-2 px-6 pt-4">
              {abasForm.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAba(a.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer ${
                    aba === a.key
                      ? "bg-blue-900/30 text-blue-400 border border-blue-800/50"
                      : "bg-[#0f111a] text-gray-400 border border-gray-800"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSalvar} className="p-6 space-y-4 overflow-y-auto">
              {aba === "dados" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Campo label="Tipo de pessoa">
                    <select value={form.tipo_pessoa} onChange={set("tipo_pessoa")} className={inputCls}>
                      <option value="PF">Pessoa Física</option>
                      <option value="PJ">Pessoa Jurídica</option>
                    </select>
                  </Campo>
                  <Campo label="Nome *">
                    <input type="text" value={form.nome} onChange={set("nome")} className={inputCls} required />
                  </Campo>
                  {form.tipo_pessoa === "PJ" && (
                    <>
                      <Campo label="Razão social">
                        <input type="text" value={form.razao_social} onChange={set("razao_social")} className={inputCls} />
                      </Campo>
                      <Campo label="CNPJ">
                        <input type="text" value={form.cnpj} onChange={set("cnpj")} className={inputCls} />
                      </Campo>
                    </>
                  )}
                  <Campo label="CPF">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.cpf}
                      onChange={(e) => setForm((f) => ({ ...f, cpf: mascaraCPF(e.target.value) }))}
                      placeholder="000.000.000-00"
                      className={inputCls}
                    />
                  </Campo>
                  <Campo label="RG">
                    <input type="text" value={form.rg} onChange={set("rg")} className={inputCls} />
                  </Campo>
                  <Campo label="Data de nascimento">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.data_nascimento}
                      onChange={(e) => setForm((f) => ({ ...f, data_nascimento: mascaraData(e.target.value) }))}
                      placeholder="DD/MM/AAAA"
                      className={inputCls}
                    />
                  </Campo>
                  <Campo label="Email">
                    <input type="email" value={form.email} onChange={set("email")} className={inputCls} />
                  </Campo>
                  <Campo label="Telefone">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.telefone}
                      onChange={(e) => setForm((f) => ({ ...f, telefone: mascaraTelefone(e.target.value) }))}
                      placeholder="(00) 00000-0000"
                      className={inputCls}
                    />
                  </Campo>
                </div>
              )}

              {aba === "endereco" && (
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                  <Campo label="CEP" className="sm:col-span-2">
                    <input type="text" value={form.cep} onChange={set("cep")} placeholder="00000-000" className={inputCls} />
                  </Campo>
                  <Campo label="Logradouro" className="sm:col-span-4">
                    <input type="text" value={form.logradouro} onChange={set("logradouro")} className={inputCls} />
                  </Campo>
                  <Campo label="Número" className="sm:col-span-2">
                    <input type="text" value={form.numero} onChange={set("numero")} className={inputCls} />
                  </Campo>
                  <Campo label="Complemento" className="sm:col-span-4">
                    <input type="text" value={form.complemento} onChange={set("complemento")} className={inputCls} />
                  </Campo>
                  <Campo label="Bairro" className="sm:col-span-3">
                    <input type="text" value={form.bairro} onChange={set("bairro")} className={inputCls} />
                  </Campo>
                  <Campo label="Cidade" className="sm:col-span-2">
                    <input type="text" value={form.cidade} onChange={set("cidade")} className={inputCls} />
                  </Campo>
                  <Campo label="UF" className="sm:col-span-1">
                    <input type="text" maxLength={2} value={form.uf} onChange={(e) => setForm((f) => ({ ...f, uf: e.target.value.toUpperCase() }))} className={inputCls} />
                  </Campo>
                </div>
              )}

              {aba === "outros" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Campo label="Status">
                    <select value={form.status} onChange={set("status")} className={inputCls}>
                      {Object.entries(statusLabels).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="ID no sistema de origem">
                    <input type="text" value={form.id_externo} onChange={set("id_externo")} className={inputCls} />
                  </Campo>
                  <Campo label="Observações" className="sm:col-span-2">
                    <textarea value={form.observacoes} onChange={set("observacoes")} rows={4} className={`${inputCls} resize-none`} />
                  </Campo>
                </div>
              )}

              {erro && <p className="text-red-400 text-sm">{erro}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 bg-[#0f111a] border border-gray-800 text-gray-300 rounded-lg hover:bg-[#252b3b] transition-colors text-sm cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm cursor-pointer disabled:opacity-50"
                >
                  {salvando ? "Salvando..." : editId === null ? "Criar Cliente" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
