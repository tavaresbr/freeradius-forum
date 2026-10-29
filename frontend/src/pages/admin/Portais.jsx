import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";

export default function Portais() {
  const [portais, setPortais] = useState([]);
  const [planos, setPlanos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nome: "", slug: "", descricao: "", html_content: "", url_redirect: "" });

  const { empresaSlug } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("admin_token");

  const carregarPlanos = async () => {
    try {
      const res = await fetch("/api/planos", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setPlanos(await res.json());
    } catch (err) { /* silencioso */ }
  };

  const carregarPortais = async () => {
    try {
      const res = await fetch("/api/portais", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setPortais(data);
    } catch (err) {
      console.error("Erro ao carregar portais:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregarPortais(); carregarPlanos(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editando ? `/api/portais/${editando}` : "/api/portais";
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.message || "Erro ao salvar");
        return;
      }
      setShowModal(false);
      setEditando(null);
      setForm({ nome: "", slug: "", descricao: "", html_content: "", url_redirect: "" });
      carregarPortais();
    } catch (err) {
      alert("Erro ao salvar portal");
    }
  };

  const handleEditar = (p) => {
    setForm({
      nome: p.nome,
      slug: p.slug,
      descricao: p.descricao || "",
      html_content: p.html_content || "",
      url_redirect: p.url_redirect || "",
    });
    setEditando(p.id);
    setShowModal(true);
  };

  const handleRemover = async (id) => {
    if (!confirm("Deseja remover este portal?")) return;
    try {
      const res = await fetch(`/api/portais/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message); return; }
      carregarPortais();
    } catch (err) {
      alert("Erro ao remover portal");
    }
  };

  const tipoBadge = (tipo) => {
    const map = {
      lgpd: { label: "LGPD", cls: "bg-cyan-900/30 text-cyan-400 border-cyan-800/50" },
      planos: { label: "Planos", cls: "bg-green-900/30 text-green-400 border-green-800/50" },
      lead: { label: "Lead", cls: "bg-yellow-900/30 text-yellow-400 border-yellow-800/50" },
      lead_passivo: { label: "Lead (Sem Internet)", cls: "bg-orange-900/30 text-orange-400 border-orange-800/50" },
      voucher: { label: "Voucher", cls: "bg-purple-900/30 text-purple-400 border-purple-800/50" },
      custom: { label: "Custom", cls: "bg-orange-900/30 text-orange-400 border-orange-800/50" },
    };
    const t = map[tipo] || map.custom;
    return <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${t.cls}`}>{t.label}</span>;
  };

  const tipoIcon = (tipo) => {
    if (tipo === "lgpd") return (
      <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
    );
    if (tipo === "planos") return (
      <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
    );
    if (tipo === "voucher") return (
      <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path></svg>
    );
    if (tipo === "lead" || tipo === "lead_passivo") return (
      <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
    );
    return (
      <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-6">
        <svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>
        <h1 className="text-2xl font-bold text-white">Portais Captive</h1>
      </div>

      {!loading && !planos.some(p => p.nome === 'LGPD') && (
        <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-start gap-3">
          <span className="text-yellow-400 text-lg">&#9888;</span>
          <div>
            <p className="text-yellow-300 font-semibold text-sm">Plano LGPD não encontrado</p>
            <p className="text-yellow-500 text-xs mt-1">O portal LGPD não funcionará sem um plano com nome <strong>"LGPD"</strong>. Vá em <strong>Planos</strong> e crie um plano gratuito com esse nome.</p>
          </div>
        </div>
      )}
      {!loading && !planos.some(p => p.nome.toLowerCase() === 'lead') && (
        <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-start gap-3">
          <span className="text-yellow-400 text-lg">&#9888;</span>
          <div>
            <p className="text-yellow-300 font-semibold text-sm">Plano Lead não encontrado</p>
            <p className="text-yellow-500 text-xs mt-1">O portal de Leads não funcionará sem um plano com nome <strong>"Lead"</strong>. Vá em <strong>Planos</strong> e crie um plano gratuito com esse nome.</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-gray-500">Carregando...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portais.map((p) => (
            <div key={p.id} className="bg-[#1a1d27] rounded-xl border border-gray-800 p-4 sm:p-5 hover:border-gray-700 transition-all">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-[#0d1117] rounded-lg shrink-0">{tipoIcon(p.tipo)}</div>
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold break-words">{p.nome}</h3>
                    <p className="text-xs text-gray-500">/{p.slug}</p>
                  </div>
                </div>
                {tipoBadge(p.tipo)}
              </div>

              {p.descricao && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{p.descricao}</p>}

              {/* Template name & branding colors */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {p.template_nome && (
                  <span className="px-2 py-0.5 text-xs rounded border bg-purple-900/30 text-purple-400 border-purple-800/50">
                    {p.template_nome}
                  </span>
                )}
                {p.cor_primaria && (
                  <div className="flex items-center gap-1" title={`Primaria: ${p.cor_primaria}`}>
                    <div className="w-3 h-3 rounded-full border border-gray-600" style={{ backgroundColor: p.cor_primaria }} />
                  </div>
                )}
                {p.cor_fundo && p.cor_fundo !== '#0f111a' && (
                  <div className="flex items-center gap-1" title={`Fundo: ${p.cor_fundo}`}>
                    <div className="w-3 h-3 rounded-full border border-gray-600" style={{ backgroundColor: p.cor_fundo }} />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"></path></svg>
                {p.mikrotiks_vinculados} Mikrotik{p.mikrotiks_vinculados !== 1 ? "s" : ""} vinculado{p.mikrotiks_vinculados !== 1 ? "s" : ""}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-800">
                <button
                  onClick={async () => {
                    // Abre a aba no clique (antes do fetch): no celular o navegador bloqueia window.open depois de um await
                    const aba = window.open("", "_blank");
                    try {
                      const r = await fetch(`/api/auth/download-token?para=portais`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!r.ok) throw new Error("token");
                      const { token: dl } = await r.json();
                      const url = `/api/portais/${p.id}/preview?token=${dl}`;
                      if (aba) aba.location.href = url;
                      else window.location.href = url;
                    } catch (err) {
                      if (aba) aba.close();
                      console.error("Erro ao abrir preview:", err);
                      alert("Nao foi possivel abrir o preview. Faca login novamente.");
                    }
                  }}
                  className="flex flex-1 sm:flex-none items-center justify-center gap-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs text-blue-400 border border-blue-800/50 rounded hover:bg-blue-900/20 transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                  Preview
                </button>
                <button
                  onClick={() => navigate(`/admin/${empresaSlug}/portais/${p.id}/editor`)}
                  className="flex flex-1 sm:flex-none items-center justify-center gap-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs text-purple-400 border border-purple-800/50 rounded hover:bg-purple-900/20 transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                  Editor Visual
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

