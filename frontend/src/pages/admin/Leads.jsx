import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";
import { mascaraCPF, validarCPF } from "../../utils/cpfUtils";
import { mascaraData, mascaraTelefone, dataNascimentoValida } from "../../utils/dataUtils";
import { mascaraCEP, buscarCep } from "../../utils/cepUtils";

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
  const { user } = useAuth();
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
  const [cepMsg, setCepMsg] = useState("");
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [statusMassa, setStatusMassa] = useState("");
  const [massaOcupada, setMassaOcupada] = useState(false);
  const cepAtual = useRef("");
  const numeroRef = useRef(null);

  const token = localStorage.getItem("admin_token");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // CEP digitado por completo: busca o endereco e preenche os campos (so quando o CEP muda por digitacao)
  const onCepChange = async (e) => {
    const cep = mascaraCEP(e.target.value);
    setForm((f) => ({ ...f, cep }));
    setCepMsg("");
    const digitos = cep.replace(/\D/g, "");
    cepAtual.current = digitos;
    if (digitos.length !== 8) return;
    setCepMsg("Buscando CEP...");
    try {
      const end = await buscarCep(digitos);
      if (cepAtual.current !== digitos) return; // CEP mudou durante a busca
      if (!end) { setCepMsg("CEP não encontrado — preencha o endereço manualmente"); return; }
      setForm((f) => ({ ...f, logradouro: end.logradouro, bairro: end.bairro, cidade: end.cidade, uf: end.uf }));
      setCepMsg("");
      numeroRef.current && numeroRef.current.focus();
    } catch {
      if (cepAtual.current === digitos) setCepMsg("Não foi possível consultar o CEP — preencha manualmente");
    }
  };

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

  // a selecao vale para a lista que esta na tela: mudou filtro/busca, recomeca
  useEffect(() => {
    setSelecionados(new Set());
  }, [statusFilter, search]);

  const todosMarcados = leads.length > 0 && leads.every((l) => selecionados.has(l.id));
  const algunsMarcados = leads.some((l) => selecionados.has(l.id));
  const alternarTodos = () => setSelecionados(todosMarcados ? new Set() : new Set(leads.map((l) => l.id)));
  const alternarUm = (id) =>
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });

  // Acao em massa: PUT /api/leads/massa (status / opt-out) ou DELETE /api/leads/massa.
  // Confirmacao e resultado ficam NA PAGINA (confirm()/alert() podem estar bloqueados pelo navegador e
  // a acao parecia "nao fazer nada").
  const [pendenteMassa, setPendenteMassa] = useState(null); // { metodo, extra, texto }
  const [msgMassa, setMsgMassa] = useState(null); // { ok, texto }

  const pedirMassa = (metodo, extra, texto) => {
    setMsgMassa(null);
    if (texto) setPendenteMassa({ metodo, extra, texto: texto.replace("{n}", selecionados.size) });
    else executarMassa(metodo, extra);
  };

  const executarMassa = async (metodo, extra) => {
    const ids = leads.filter((l) => selecionados.has(l.id)).map((l) => l.id);
    setPendenteMassa(null);
    if (ids.length === 0) return;
    setMassaOcupada(true);
    setMsgMassa({ ok: true, texto: "Aplicando..." });
    try {
      const res = await fetch(`${API}/api/leads/massa`, {
        method: metodo,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgMassa({ ok: false, texto: `${data.message || data.error || "Não foi possível concluir a ação"} (HTTP ${res.status})` });
        return;
      }
      setSelecionados(new Set());
      setStatusMassa("");
      setMsgMassa({ ok: true, texto: `${data.afetados ?? ids.length} cadastro(s) atualizado(s).` });
      fetchLeads();
    } catch (err) {
      console.error("Erro na ação em massa:", err);
      setMsgMassa({ ok: false, texto: "Erro de conexão com o servidor. Tente novamente." });
    } finally {
      setMassaOcupada(false);
    }
  };

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

  // Cliente respondeu SAIR (ou voltou a querer): liga/desliga o opt-out de promocoes por WhatsApp
  const handleOptout = async (lead) => {
    const sair = !Number(lead.whatsapp_optout);
    try {
      await fetch(`${API}/api/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ whatsapp_optout: sair }),
      });
      fetchLeads();
    } catch (err) {
      console.error("Erro ao atualizar opt-out:", err);
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
    setCepMsg("");
    setShowModal(true);
  };

  const abrirEdicao = (lead) => {
    setEditId(lead.id);
    setForm(deLead(lead));
    setAba("dados");
    setErro("");
    setCepMsg("");
    setShowModal(true);
  };

  // Obrigatorios: nome, CPF (PF) ou CNPJ (PJ), e-mail, data de nascimento e telefone
  const validarForm = () => {
    const pj = form.tipo_pessoa === "PJ";
    if (!form.nome.trim()) return "Informe o nome";
    if (pj) {
      if (form.cnpj.replace(/\D/g, "").length !== 14) return "Informe um CNPJ válido (14 dígitos)";
    } else if (!validarCPF(form.cpf)) {
      return "Informe um CPF válido";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Informe um e-mail válido";
    if (!dataNascimentoValida(form.data_nascimento)) return "Informe a data de nascimento (DD/MM/AAAA)";
    const tel = form.telefone.replace(/\D/g, "");
    if (tel.length < 10 || tel.length > 11) return "Informe o telefone com DDD";
    return "";
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setErro("");
    const invalido = validarForm();
    if (invalido) {
      setAba("dados"); // os obrigatorios ficam na aba Dados
      setErro(invalido);
      return;
    }
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
      // SaaS: a exportacao so existe em plano/adicional que a inclua (o servidor tambem recusa).
      const st = await fetch(`${API}/api/assinatura/status`, { headers: { Authorization: `Bearer ${token}` } })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (st?.recursos?.exportacao === false && user?.role !== "super_admin") {
        alert("A exportação da base de clientes não está incluída no seu plano. Contrate o plano ou o adicional em Assinatura.");
        return;
      }
      const r = await fetch(`${API}/api/auth/download-token?para=leads`, {
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

        {msgMassa && (
          <div className={`rounded-lg px-4 py-2 text-sm border ${msgMassa.ok ? "bg-green-900/20 border-green-800/50 text-green-300" : "bg-red-900/20 border-red-800/50 text-red-300"}`}>
            {msgMassa.texto}
          </div>
        )}
        {pendenteMassa && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm border border-yellow-800/50 bg-yellow-900/20 text-yellow-200">
            <span>{pendenteMassa.texto}</span>
            <button
              onClick={() => executarMassa(pendenteMassa.metodo, pendenteMassa.extra)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 cursor-pointer"
            >
              Confirmar
            </button>
            <button onClick={() => setPendenteMassa(null)} className="px-3 py-1.5 text-gray-300 border border-gray-700 rounded-md text-xs hover:bg-gray-800 cursor-pointer">
              Cancelar
            </button>
          </div>
        )}

        {/* Ações em massa */}
        {selecionados.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 bg-blue-900/20 border border-blue-800/50 rounded-xl px-4 py-3 text-sm">
            <span className="text-blue-300 font-medium">{selecionados.size} selecionado(s)</span>
            <select
              value={statusMassa}
              onChange={(e) => setStatusMassa(e.target.value)}
              className="px-2 py-1.5 bg-[#1a1d27] border border-gray-700 rounded-md text-gray-300 text-xs"
            >
              <option value="">Alterar status para...</option>
              {Object.entries(statusLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <button
              disabled={!statusMassa || massaOcupada}
              onClick={() => pedirMassa("PUT", { status: statusMassa })}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
            >
              Aplicar
            </button>
            <button
              disabled={massaOcupada}
              onClick={() => pedirMassa("PUT", { whatsapp_optout: true }, "Marcar {n} cliente(s) como 'não quer promoções'?")}
              className="px-3 py-1.5 text-yellow-400 border border-yellow-800/50 rounded-md text-xs hover:bg-yellow-900/20 disabled:opacity-40 cursor-pointer"
            >
              Não quer promoções
            </button>
            <button
              disabled={massaOcupada}
              onClick={() => pedirMassa("PUT", { whatsapp_optout: false }, "Voltar a enviar promoções para {n} cliente(s)?")}
              className="px-3 py-1.5 text-gray-300 border border-gray-700 rounded-md text-xs hover:bg-gray-800 disabled:opacity-40 cursor-pointer"
            >
              Voltar a receber promoções
            </button>
            <button
              disabled={massaOcupada}
              onClick={() => pedirMassa("DELETE", {}, "Excluir {n} cadastro(s)? Esta ação não pode ser desfeita.")}
              className="px-3 py-1.5 text-red-400 border border-red-800/50 rounded-md text-xs hover:bg-red-900/20 disabled:opacity-40 cursor-pointer"
            >
              Excluir selecionados
            </button>
            <button
              onClick={() => setSelecionados(new Set())}
              className="ml-auto text-gray-400 hover:text-gray-200 text-xs cursor-pointer"
            >
              Limpar seleção
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      checked={todosMarcados}
                      ref={(el) => { if (el) el.indeterminate = !todosMarcados && algunsMarcados; }}
                      onChange={alternarTodos}
                      className="cursor-pointer"
                    />
                  </th>
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
                    <td colSpan="10" className="text-center py-8 text-gray-500">
                      Carregando...
                    </td>
                  </tr>
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan="10" className="text-center py-8 text-gray-500">
                      Nenhum cadastro encontrado
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-[#252b3b]/30">
                      <td className="px-4 py-3 w-8">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${lead.nome || lead.id}`}
                          checked={selecionados.has(lead.id)}
                          onChange={() => alternarUm(lead.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {lead.nome || "-"}
                        {Number(lead.whatsapp_optout) === 1 && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800/50" title="Não recebe promoções por WhatsApp">sem promoções</span>
                        )}
                      </td>
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
                          onClick={() => handleOptout(lead)}
                          className="text-yellow-400 hover:text-yellow-300 text-xs cursor-pointer mr-3"
                          title="Marque quando o cliente responder SAIR às promoções por WhatsApp"
                        >
                          {Number(lead.whatsapp_optout) === 1 ? "Voltar a receber promoções" : "Não quer promoções"}
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
                      <Campo label="CNPJ *">
                        <input type="text" value={form.cnpj} onChange={set("cnpj")} className={inputCls} />
                      </Campo>
                    </>
                  )}
                  <Campo label={form.tipo_pessoa === "PJ" ? "CPF" : "CPF *"}>
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
                  <Campo label="Data de nascimento *">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.data_nascimento}
                      onChange={(e) => setForm((f) => ({ ...f, data_nascimento: mascaraData(e.target.value) }))}
                      placeholder="DD/MM/AAAA"
                      className={inputCls}
                    />
                  </Campo>
                  <Campo label="Email *">
                    <input type="email" value={form.email} onChange={set("email")} className={inputCls} />
                  </Campo>
                  <Campo label="Telefone *">
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
                    <input type="text" inputMode="numeric" value={form.cep} onChange={onCepChange} placeholder="00000-000" className={inputCls} />
                    {cepMsg && <p className="text-xs text-gray-400 mt-1">{cepMsg}</p>}
                  </Campo>
                  <Campo label="Logradouro" className="sm:col-span-4">
                    <input type="text" value={form.logradouro} onChange={set("logradouro")} className={inputCls} />
                  </Campo>
                  <Campo label="Número" className="sm:col-span-2">
                    <input type="text" ref={numeroRef} value={form.numero} onChange={set("numero")} className={inputCls} />
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
