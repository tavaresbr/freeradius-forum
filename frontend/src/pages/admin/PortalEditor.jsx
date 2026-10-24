import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { CAMPOS_PADRAO, normalizarCampos } from "../../utils/camposPortal";

const defaultConfigs = {
  lgpd: {
    titulo: "Cadastro",
    subtitulo: "Seus dados protegidos pela Lei Geral de Proteção de Dados",
    texto_botao: "Cadastrar e Continuar",
    texto_rodape: "Seus dados estão protegidos e serão utilizados apenas para os fins estabelecidos em nossa política de privacidade.",
    texto_lgpd: "Aceito os termos da Lei Geral de Proteção de Dados (LGPD) e autorizo o tratamento dos meus dados pessoais, incluindo a data de nascimento, que será utilizada para confirmar minha identidade e recuperar meu cadastro. *",
    cor_fundo_1: "#075985",
    cor_fundo_2: "#172554",
    cor_botao: "#3B82F6",
    logo_url: "",
    campos: CAMPOS_PADRAO,
  },
  lead: {
    titulo: "WiFi Grátis",
    subtitulo: "Preencha seus dados para acessar a internet",
    texto_botao: "Conectar à Internet",
    texto_rodape: "Ao conectar você concorda com os termos de uso da rede WiFi.",
    cor_fundo_1: "#065f46",
    cor_fundo_2: "#083344",
    cor_botao: "#059669",
    logo_url: "",
  },
  lead_passivo: {
    titulo: "Receber Novidades",
    subtitulo: "Cadastre-se para entrarmos em contato",
    texto_botao: "Me Cadastrar",
    texto_rodape: "Seus dados estão seguros conosco e não serão compartilhados.",
    texto_sucesso_titulo: "Obrigado!",
    texto_sucesso_mensagem: "Recebemos seus dados em breve entraremos em contato.",
    cor_fundo_1: "#431407",
    cor_fundo_2: "#7c2d12",
    cor_botao: "#ea580c",
    logo_url: "",
  },
  planos: {
    titulo: "Escolha seu Plano",
    subtitulo: "Selecione o melhor plano para navegar",
    texto_botao: "Continuar",
    texto_rodape: "Pagamento seguro e rápido.",
    cor_fundo_1: "#581c87",
    cor_fundo_2: "#1e1b4b",
    cor_botao: "#7C3AED",
    logo_url: "",
  },
  login: {
    titulo: "Acesso Wi-Fi",
    subtitulo: "Faça login com seu usuário e senha para acessar a internet",
    texto_botao: "Conectar",
    texto_rodape: "Ao conectar você concorda com os termos de uso da rede.",
    link_texto_antes: "Não tem um plano? ",
    link_texto_link: "Clique aqui",
    link_texto_depois: " para adquirir o seu.",
    link_portal_url: "",
    cor_fundo_1: "#1f2937",
    cor_fundo_2: "#111827",
    cor_botao: "#3b82f6",
    logo_url: "",
  },
};

const iconPaths = {
  lgpd: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  lead: "M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0",
  lead_passivo: "M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0",
  planos: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  login: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
};

export default function PortalEditor() {
  const { empresaSlug, portalId } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("admin_token");

  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [editingField, setEditingField] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [outrosPortais, setOutrosPortais] = useState([]);
  const [campanhasDisponiveis, setCampanhasDisponiveis] = useState([]);
  const [campanhaAtivaId, setCampanhaAtivaId] = useState(null);

  const [config, setConfig] = useState({});
  const [whatsEnabled, setWhatsEnabled] = useState(false);
  const [whatsTemplate, setWhatsTemplate] = useState("");
  const [whatsPreview, setWhatsPreview] = useState("");
  const [whatsTesteTel, setWhatsTesteTel] = useState("");
  const [whatsTesteMsg, setWhatsTesteMsg] = useState(null);
  const whatsTextareaRef = useRef(null);

  const WHATS_VARS = ["nome", "username", "password", "plano", "duracao", "velocidade", "valor", "empresa", "login_url", "expira_em", "cpf"];

  useEffect(() => { loadPortal(); loadCampanhas(); }, []);

  const loadPortal = async () => {
    try {
      const res = await fetch(`/api/portais`, { headers: { Authorization: `Bearer ${token}` } });
      const portais = await res.json();
      const p = portais.find((x) => String(x.id) === String(portalId));
      if (p) {
        setPortal(p);
        setOutrosPortais(portais.filter((x) => String(x.id) !== String(portalId)));
        setCampanhaAtivaId(p.campanha_ativa_id || null);
        const defaults = defaultConfigs[p.tipo] || defaultConfigs.lgpd;
        let saved = {};
        if (p.configuracoes) {
          try { saved = JSON.parse(p.configuracoes); } catch (e) {}
        }
        const merged = { ...defaults, ...saved };
        // Campos do formulário (Visível/Obrigatório): mescla campo a campo com os padrões
        if (p.tipo === "lgpd") merged.campos = normalizarCampos(saved.campos);
        setConfig(merged);
        setWhatsEnabled(!!p.whatsapp_enabled);
        setWhatsTemplate(p.whatsapp_template || "");
      }
    } catch (err) {
      console.error("Erro:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadCampanhas = async () => {
    try {
      const res = await fetch(`/api/campanhas`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCampanhasDisponiveis(Array.isArray(data) ? data : (data.data || []));
      }
    } catch (err) {
      console.error("Erro ao carregar campanhas:", err);
    }
  };

  const salvarCampanha = async (valor) => {
    const novoId = valor === "" ? null : parseInt(valor, 10);
    try {
      const res = await fetch(`/api/portais/${portalId}/campanha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ campanha_ativa_id: novoId }),
      });
      if (!res.ok) throw new Error("Erro ao salvar campanha");
      setCampanhaAtivaId(novoId);
    } catch (err) {
      alert("Erro ao salvar campanha: " + err.message);
    }
  };

  const inserirVariavel = (nome) => {
    const textarea = whatsTextareaRef.current;
    const tag = `{{${nome}}}`;
    if (!textarea) {
      setWhatsTemplate((t) => (t || "") + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const antes = (whatsTemplate || "").slice(0, start);
    const depois = (whatsTemplate || "").slice(end);
    const novo = antes + tag + depois;
    setWhatsTemplate(novo);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    }, 0);
  };

  const gerarPreviewWhats = async () => {
    try {
      const res = await fetch(`/api/portais/${portalId}/whatsapp-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ template: whatsTemplate }),
      });
      const data = await res.json();
      if (res.ok) setWhatsPreview(data.preview || "");
    } catch (err) {
      setWhatsPreview("Erro ao gerar preview");
    }
  };

  const enviarTesteWhats = async () => {
    if (!whatsTesteTel.trim()) {
      setWhatsTesteMsg({ ok: false, msg: "Informe um telefone" });
      return;
    }
    setWhatsTesteMsg({ ok: null, msg: "Enviando..." });
    try {
      const res = await fetch(`/api/portais/${portalId}/whatsapp-teste`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ telefone: whatsTesteTel, template: whatsTemplate }),
      });
      const data = await res.json();
      if (res.ok) setWhatsTesteMsg({ ok: true, msg: "Mensagem enviada!" });
      else setWhatsTesteMsg({ ok: false, msg: data.message || "Erro ao enviar" });
    } catch (err) {
      setWhatsTesteMsg({ ok: false, msg: "Erro de conexão" });
    }
  };

  // Campos do formulário do portal LGPD (Visível / Obrigatório). CPF é sempre obrigatório.
  const camposLgpd = normalizarCampos(config.campos);
  const setCampo = (chave, prop, valor) => {
    const campos = normalizarCampos(config.campos);
    campos[chave] = { ...campos[chave], [prop]: valor };
    setConfig({ ...config, campos: normalizarCampos(campos) });
  };
  const renderToggle = (checked, onChange, rotulo, desabilitado = false) => (
    <label className={`relative inline-flex items-center ${desabilitado ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={desabilitado} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
      <span className="ml-2 text-xs text-gray-500">{rotulo}</span>
    </label>
  );
  const renderCampoLgpd = (chave, rotulo, icone, exemplo) => {
    const c = camposLgpd[chave];
    return (
      <div key={chave} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg" data-campo={chave}>
          <span className="text-sm font-medium text-gray-700">{icone} {rotulo}</span>
          <div className="flex items-center gap-4">
            {renderToggle(c.visivel, (v) => setCampo(chave, "visivel", v), c.visivel ? "Visível" : "Oculto")}
            {renderToggle(c.obrigatorio, (v) => setCampo(chave, "obrigatorio", v), c.obrigatorio ? "Obrigatório" : "Opcional", !c.visivel)}
          </div>
        </div>
        {c.visivel && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{rotulo}{c.obrigatorio ? " *" : ""}</label>
            <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
              <span className="text-gray-400 mr-2">{icone}</span>
              <span className="text-gray-400 text-sm">{exemplo}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/portais/${portalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          configuracoes: config,
          cor_primaria: config.cor_botao,
          cor_fundo: config.cor_fundo_1,
          logo_url: config.logo_url,
          whatsapp_enabled: whatsEnabled,
          whatsapp_template: whatsTemplate,
        }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      setMsg("Salvo!");
      setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setMsg("Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const fileInputRef = useRef(null);
  
  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("logo", file);
    
    setMsg("Enviando logo...");
    try {
      const res = await fetch(`/api/portais/${portalId}/logo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro no upload");
      setConfig({ ...config, logo_url: data.logo_url });
      setMsg("Logo atualizada!");
      setTimeout(() => setMsg(""), 2000);
    } catch (err) {
      setMsg("Erro no upload");
      console.error(err);
    }
  };

  const EditableText = ({ field, tag: Tag = "span", className = "", style = {} }) => {
    const isEditing = editingField === field;
    const ref = useRef(null);

    return isEditing ? (
      <input
        ref={(el) => el && el.focus()}
        type="text"
        value={config[field] || ""}
        onChange={(e) => setConfig({ ...config, [field]: e.target.value })}
        onBlur={() => setEditingField(null)}
        onKeyDown={(e) => e.key === "Enter" && setEditingField(null)}
        className="bg-white/20 border-2 border-blue-400 rounded px-2 py-1 text-inherit outline-none w-full"
        style={{ ...style, fontSize: "inherit", fontWeight: "inherit" }}
      />
    ) : (
      <Tag
        className={`${className} cursor-pointer hover:outline hover:outline-2 hover:outline-blue-400 hover:outline-offset-2 rounded transition-all relative group`}
        style={style}
        onClick={() => setEditingField(field)}
      >
        {config[field] || "Clique para editar"}
        <span className="absolute -top-5 left-0 text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          ✏️ Editar
        </span>
      </Tag>
    );
  };

  const ColorDot = ({ field, label }) => (
    <div className="relative">
      <button
        onClick={() => setShowColorPicker(showColorPicker === field ? null : field)}
        className="flex items-center gap-2 cursor-pointer group"
        title={label}
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-white/30 group-hover:border-blue-400 transition-colors shadow-lg"
          style={{ backgroundColor: config[field] }}
        />
        <span className="text-[10px] text-white/60 group-hover:text-blue-300 transition-colors">{label}</span>
      </button>
      {showColorPicker === field && (
        <div className="absolute top-8 left-0 z-50 bg-[#1a1d27] border border-gray-700 rounded-lg p-3 shadow-2xl">
          <input
            type="color"
            value={config[field]}
            onChange={(e) => setConfig({ ...config, [field]: e.target.value })}
            className="w-32 h-8 rounded cursor-pointer bg-transparent border-0"
          />
          <input
            type="text"
            value={config[field]}
            onChange={(e) => setConfig({ ...config, [field]: e.target.value })}
            className="w-32 mt-1 bg-[#0d1117] border border-gray-600 text-white rounded px-2 py-1 text-xs font-mono"
          />
          <button
            onClick={() => setShowColorPicker(null)}
            className="w-full mt-1 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
          >OK</button>
        </div>
      )}
    </div>
  );

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center h-64 text-gray-500">Carregando...</div></AdminLayout>;
  }
  if (!portal) {
    return <AdminLayout><div className="flex items-center justify-center h-64 text-red-400">Portal não encontrado</div></AdminLayout>;
  }

  const tipoBadge = {
    lgpd: { label: "LGPD", cls: "bg-cyan-900/30 text-cyan-400 border-cyan-800/50" },
    planos: { label: "Planos", cls: "bg-green-900/30 text-green-400 border-green-800/50" },
    lead: { label: "Lead", cls: "bg-yellow-900/30 text-yellow-400 border-yellow-800/50" },
    lead_passivo: { label: "Lead (Sem Internet)", cls: "bg-orange-900/30 text-orange-400 border-orange-800/50" },
    login: { label: "Login", cls: "bg-blue-900/30 text-blue-400 border-blue-800/50" },
  };
  const badge = tipoBadge[portal.tipo] || { label: portal.tipo, cls: "bg-gray-900/30 text-gray-400 border-gray-800/50" };
  const iconPath = iconPaths[portal.tipo] || iconPaths.lgpd;

  return (
    <AdminLayout>
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/admin/${empresaSlug}/portais`)} className="p-2 text-gray-400 hover:text-white hover:bg-[#252b3b] rounded-lg cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white">Editor Visual</h1>
              <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${badge.cls}`}>{badge.label}</span>
            </div>
            <p className="text-xs text-gray-500">Clique nos elementos para editar diretamente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-sm ${msg === "Salvo!" ? "text-green-400" : "text-red-400"}`}>{msg}</span>}
          <button onClick={() => navigate(`/admin/${empresaSlug}/portais`)} className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#252b3b] cursor-pointer text-sm">Voltar</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 cursor-pointer text-sm disabled:opacity-50">
            {saving ? "Salvando..." : "💾 Salvar"}
          </button>
        </div>
      </div>

      {/* Editor Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-gray-700 shadow-2xl" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Color Controls Bar */}
        <div className="absolute top-3 right-3 z-40 flex items-center gap-3 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2">
          <ColorDot field="cor_fundo_1" label="Fundo 1" />
          <ColorDot field="cor_fundo_2" label="Fundo 2" />
          <ColorDot field="cor_botao" label="Botão" />
        </div>

        {/* Portal Preview - Mirrors the real portal layout */}
        <div
          className="min-h-[700px] flex items-center justify-center px-4 py-12 transition-colors duration-300"
          style={{ background: `linear-gradient(135deg, ${config.cor_fundo_1}, ${config.cor_fundo_2})` }}
        >
          <div className="w-full max-w-md">
            {/* Header */}
            <div className="text-center mb-8">
              {/* Logo area */}
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/png, image/jpeg, image/webp, image/gif, image/svg+xml"
                onChange={handleLogoUpload} 
              />
              <div
                className="group relative inline-block mb-4 cursor-pointer"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
              >
                {config.logo_url ? (
                  <img src={config.logo_url} alt="Logo" className="max-h-16 mx-auto group-hover:opacity-70 transition-opacity" />
                ) : (
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 group-hover:border-blue-400 transition-colors">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
                    </svg>
                  </div>
                )}
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  📷 {config.logo_url ? "Alterar Logo" : "Upload da Logo"}
                </span>
                {config.logo_url && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfig({ ...config, logo_url: "" });
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full text-[10px] opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all flex items-center justify-center"
                    title="Remover logo"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Título */}
              <EditableText field="titulo" tag="h1" className="text-3xl font-bold text-white mb-2" />

              {/* Subtítulo */}
              <EditableText field="subtitulo" tag="p" className="text-sm" style={{ color: `${config.cor_fundo_1}33` === '#00000033' ? '#93c5fd' : lightenColor(config.cor_fundo_1, 60) }} />
            </div>

            {/* Form Card (visual only - not functional) */}
            <div className="bg-white text-gray-800 p-8 rounded-2xl shadow-2xl">
              {/* Campos de exemplo */}
              <div className="space-y-5">
                {portal.tipo === "lgpd" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CPF *</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">🆔</span>
                        <span className="text-gray-400 text-sm">000.000.000-00</span>
                      </div>
                    </div>
                    {renderCampoLgpd("nome", "Nome Completo", "👤", "Seu nome completo")}
                    {renderCampoLgpd("email", "E-mail", "✉️", "seu@email.com")}
                    {renderCampoLgpd("telefone", "Telefone", "📞", "(00) 00000-0000")}
                    <p className="text-xs text-gray-400">O CPF é sempre obrigatório. Campos obrigatórios também são exigidos pelo servidor.</p>
                  </>
                )}
                {(portal.tipo === "lead" || portal.tipo === "lead_passivo") && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">👤</span>
                        <span className="text-gray-400 text-sm">Seu nome</span>
                      </div>
                    </div>
                    {/* CPF Toggle + Preview */}
                    <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">🪪</span>
                        <span className="text-sm font-medium text-gray-700">Campo CPF</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.exibir_cpf !== false}
                          onChange={(e) => setConfig({ ...config, exibir_cpf: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                        <span className="ml-2 text-xs text-gray-500">{config.exibir_cpf !== false ? "Visível" : "Oculto"}</span>
                      </label>
                    </div>
                    {config.exibir_cpf !== false && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                        <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                          <span className="text-gray-400 mr-2">🪪</span>
                          <span className="text-gray-400 text-sm">000.000.000-00</span>
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">✉️</span>
                        <span className="text-gray-400 text-sm">seu@email.com</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">📞</span>
                        <span className="text-gray-400 text-sm">(00) 00000-0000</span>
                      </div>
                    </div>
                  </>
                )}
                {portal.tipo === "planos" && (
                  <>
                    {/* Preview do Cadastro */}
                    <div className="mb-4">
                      <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide text-center">Etapa 1: Cadastro do Cliente</p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo *</label>
                          <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                            <span className="text-gray-400 mr-2">👤</span>
                            <span className="text-gray-400 text-sm">Seu nome completo</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">CPF *</label>
                          <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                            <span className="text-gray-400 mr-2">🪪</span>
                            <span className="text-gray-400 text-sm">000.000.000-00</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                          <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                            <span className="text-gray-400 mr-2">📧</span>
                            <span className="text-gray-400 text-sm">seu@email.com</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Telefone *</label>
                          <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                            <span className="text-gray-400 mr-2">📱</span>
                            <span className="text-gray-400 text-sm">(00) 00000-0000</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4 mt-4">
                      <p className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wide text-center">Etapa 2: Seleção de Plano</p>
                      <p className="text-center text-sm text-gray-500">Os planos disponíveis serão listados aqui</p>
                    </div>

                    <div className="border-t border-gray-200 pt-4 mt-4">
                      <p className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wide text-center">Etapa 3: Pagamento PIX</p>
                      <p className="text-center text-sm text-gray-500">QR Code e código copia-cola</p>
                    </div>
                  </>
                )}
                {portal.tipo === "login" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Usuário</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">👤</span>
                        <span className="text-gray-400 text-sm">Seu usuário</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                      <div className="flex items-center border border-gray-300 rounded-lg px-3 py-3 bg-gray-50">
                        <span className="text-gray-400 mr-2">🔒</span>
                        <span className="text-gray-400 text-sm">Sua senha secreta</span>
                      </div>
                    </div>
                  </>
                )}

                {/* MAC/IP row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">MAC (Automático)</label>
                    <div className="border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-400 text-xs">AA:BB:CC:DD:EE:FF</div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">IP (Automático)</label>
                    <div className="border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 text-gray-400 text-xs">192.168.1.100</div>
                  </div>
                </div>

                {/* LGPD checkbox */}
                {portal.tipo === "lgpd" && (
                  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="w-4 h-4 mt-0.5 border-2 border-gray-300 rounded flex-shrink-0" />
                    <EditableText 
                      field="texto_lgpd" 
                      tag="span" 
                      className="text-xs text-gray-600" 
                    />
                  </div>
                )}

                {/* Button */}
                <button
                  className="w-full py-3.5 rounded-xl font-semibold text-white shadow-lg flex items-center justify-center gap-2 cursor-pointer group relative hover:outline hover:outline-2 hover:outline-blue-400 hover:outline-offset-2 transition-all"
                  style={{ backgroundColor: config.cor_botao }}
                  onClick={() => setEditingField("texto_botao")}
                >
                  {editingField === "texto_botao" ? (
                    <input
                      type="text"
                      value={config.texto_botao}
                      onChange={(e) => setConfig({ ...config, texto_botao: e.target.value })}
                      onBlur={() => setEditingField(null)}
                      onKeyDown={(e) => e.key === "Enter" && setEditingField(null)}
                      className="bg-transparent text-center text-white font-semibold outline-none w-full"
                      autoFocus
                    />
                  ) : (
                    <>
                      {config.texto_botao}
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        ✏️ Editar texto
                      </span>
                    </>
                  )}
                </button>
                {portal.tipo === "login" && (
                  <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide text-center">🔗 Link para outro Portal</p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Portal de destino:</label>
                      <select
                        value={config.link_portal_url || ""}
                        onChange={(e) => {
                          const url = e.target.value;
                          // Tambem salva o id do portal de destino. Isso e' essencial pro
                          // destino (PlanosCliente/Pagamento) carregar as configs corretas
                          // (PIX/cartao toggles, trial, whatsapp). Sem isso, o destino
                          // resolveria portal via mikrotiks.portal_id, que e' o portal Login.
                          const portalDestino = outrosPortais.find((op) => op.url_redirect === url);
                          setConfig({
                            ...config,
                            link_portal_url: url,
                            link_portal_id: portalDestino ? portalDestino.id : null,
                          });
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
                      >
                        <option value="">Nenhum (sem link)</option>
                        {outrosPortais.map((op) => (
                          <option key={op.id} value={op.url_redirect}>
                            {op.nome} ({op.url_redirect})
                          </option>
                        ))}
                      </select>
                    </div>
                    {config.link_portal_url && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Texto antes do link:</label>
                          <input type="text" value={config.link_texto_antes || ""} onChange={(e) => setConfig({ ...config, link_texto_antes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" placeholder="Não tem um plano? " />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Texto do link (clicável):</label>
                          <input type="text" value={config.link_texto_link || ""} onChange={(e) => setConfig({ ...config, link_texto_link: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" placeholder="Clique aqui" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Texto depois do link:</label>
                          <input type="text" value={config.link_texto_depois || ""} onChange={(e) => setConfig({ ...config, link_texto_depois: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" placeholder=" para adquirir o seu." />
                        </div>
                        <div className="p-3 bg-white border border-gray-200 rounded-lg text-center text-sm text-gray-600">
                          <span>Preview: </span>
                          <span>{config.link_texto_antes}</span>
                          <span className="text-blue-600 underline font-medium">{config.link_texto_link}</span>
                          <span>{config.link_texto_depois}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {portal.tipo === "lead_passivo" && (
                  <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                    <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide">Preview: Tela de Obrigado</p>
                    <EditableText field="texto_sucesso_titulo" tag="h3" className="text-xl font-bold text-gray-800 mb-2" />
                    <EditableText field="texto_sucesso_mensagem" tag="p" className="text-sm text-gray-600" />

                    {/* Redirect config */}
                    <div className="mt-4 pt-4 border-t border-gray-200 text-left space-y-3">
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide text-center">⏩ Redirecionamento Automático</p>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Redirecionar para:</label>
                        <select
                          value={config.redirect_portal_url || ""}
                          onChange={(e) => setConfig({ ...config, redirect_portal_url: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
                        >
                          <option value="">Nenhum (fica na tela de Obrigado)</option>
                          {outrosPortais.map((op) => (
                            <option key={op.id} value={op.url_redirect}>
                              {op.nome} ({op.url_redirect})
                            </option>
                          ))}
                        </select>
                      </div>
                      {config.redirect_portal_url && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tempo antes de redirecionar (segundos):</label>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={config.redirect_delay || 3}
                            onChange={(e) => setConfig({ ...config, redirect_delay: parseInt(e.target.value) || 3 })}
                            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="mt-6 pt-5 border-t border-gray-200">
                <EditableText field="texto_rodape" tag="p" className="text-xs text-gray-500 text-center leading-relaxed" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pré-Portal (Campanha) */}
      <div className="mt-6 bg-[#1a1d27] border border-gray-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-purple-900/30 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Pré-Portal (Campanha)</h2>
            <p className="text-xs text-gray-500">Conteúdo exibido antes do portal (stories, vídeo, banner)</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Campanha ativa</label>
            <select
              value={campanhaAtivaId === null ? "" : String(campanhaAtivaId)}
              onChange={(e) => salvarCampanha(e.target.value)}
              className="w-full bg-[#0d1117] border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">— Nenhuma —</option>
              {campanhasDisponiveis.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nome} ({c.total_itens} {c.total_itens === 1 ? "item" : "itens"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <a
              href={`/admin/${empresaSlug}/campanhas`}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Gerenciar campanhas →
            </a>
          </div>
        </div>
      </div>

      {/* Métodos de Pagamento (só portal tipo planos) */}
      {portal.tipo === "planos" && (
        <div className="mt-6 bg-[#1a1d27] border border-gray-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-blue-900/30 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Métodos de Pagamento</h2>
              <p className="text-xs text-gray-500">Escolha quais formas de pagamento ficam visíveis no portal</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* PIX */}
            <div className={`flex items-center justify-between p-4 rounded-lg border ${config.pagamento_pix_ativo !== false ? "border-green-800/50 bg-green-900/10" : "border-gray-800 bg-[#0f111a]"}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#0f111a] flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">PIX</p>
                  <p className="text-xs text-gray-500">QR Code instantâneo</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.pagamento_pix_ativo !== false}
                  onChange={(e) => {
                    const novo = e.target.checked;
                    // Nao deixa desligar os dois ao mesmo tempo
                    if (!novo && config.pagamento_cartao_ativo === false) {
                      alert("Pelo menos um método de pagamento deve ficar ativo.");
                      return;
                    }
                    setConfig({ ...config, pagamento_pix_ativo: novo });
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-checked:bg-green-600 rounded-full peer transition-colors"></div>
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
              </label>
            </div>

            {/* Cartão */}
            <div className={`flex items-center justify-between p-4 rounded-lg border ${config.pagamento_cartao_ativo !== false ? "border-blue-800/50 bg-blue-900/10" : "border-gray-800 bg-[#0f111a]"}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#0f111a] flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Cartão de Crédito</p>
                  <p className="text-xs text-gray-500">Pagamento processado</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.pagamento_cartao_ativo !== false}
                  onChange={(e) => {
                    const novo = e.target.checked;
                    if (!novo && config.pagamento_pix_ativo === false) {
                      alert("Pelo menos um método de pagamento deve ficar ativo.");
                      return;
                    }
                    setConfig({ ...config, pagamento_cartao_ativo: novo });
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-checked:bg-blue-600 rounded-full peer transition-colors"></div>
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
              </label>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Se apenas um método estiver ativo, o portal irá direto para ele sem exibir a tela de escolha.
          </p>

          {/* Acesso Free 5min ao copiar PIX */}
          <div className="mt-6 pt-6 border-t border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-900/30 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Acesso grátis ao copiar PIX</h3>
                  <p className="text-xs text-gray-500">Libera internet temporária pro cliente abrir o app e pagar</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.pix_trial_enabled === true}
                  onChange={(e) => setConfig({ ...config, pix_trial_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-checked:bg-emerald-600 rounded-full peer transition-colors"></div>
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
              </label>
            </div>

            {config.pix_trial_enabled && (
              <div className="pl-11 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Duração:</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={config.pix_trial_duracao_minutos || 5}
                    onChange={(e) => setConfig({ ...config, pix_trial_duracao_minutos: parseInt(e.target.value, 10) || 5 })}
                    className="w-20 bg-[#0d1117] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-gray-400">minutos</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Ao clicar em "Copiar PIX", o cliente recebe acesso temporário à internet para abrir o app do banco.
                  Limite: 1 liberação a cada 24 h por CPF. Se o cliente não pagar, fica bloqueado até completar o pagamento.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notificação WhatsApp */}
      <div className="mt-6 bg-[#1a1d27] border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-900/30 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 20l1.3-3.9A9 9 0 113.9 18.7L3 20zm9-14a7 7 0 00-5.9 10.7l.3.5-.8 2.3 2.4-.8.5.3A7 7 0 1012 6z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Notificação WhatsApp</h2>
              <p className="text-xs text-gray-500">Mensagem enviada automaticamente ao liberar acesso via este portal</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={whatsEnabled}
              onChange={(e) => setWhatsEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-checked:bg-green-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-green-500/50 transition-colors"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        <div className={`space-y-4 ${!whatsEnabled ? "opacity-50 pointer-events-none" : ""}`}>
          {/* Variaveis */}
          <div>
            <p className="text-xs text-gray-400 mb-2">Variáveis disponíveis (clique para inserir no cursor):</p>
            <div className="flex flex-wrap gap-2">
              {WHATS_VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => inserirVariavel(v)}
                  className="px-2.5 py-1 text-xs font-mono bg-[#0d1117] border border-gray-700 text-green-400 rounded hover:bg-green-900/20 hover:border-green-700 transition-colors cursor-pointer"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Template */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Mensagem</label>
              <textarea
                ref={whatsTextareaRef}
                value={whatsTemplate}
                onChange={(e) => setWhatsTemplate(e.target.value)}
                rows={10}
                placeholder="✅ Acesso liberado!&#10;&#10;Olá {{nome}}! Seu plano {{plano}} foi ativado..."
                className="w-full bg-[#0d1117] border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:ring-1 focus:ring-green-500 focus:border-green-500 font-mono resize-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-400">Preview (com dados de exemplo)</label>
                <button
                  type="button"
                  onClick={gerarPreviewWhats}
                  className="text-xs text-green-400 hover:text-green-300 cursor-pointer"
                >
                  Atualizar preview
                </button>
              </div>
              <div className="bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-300 whitespace-pre-wrap min-h-[245px] font-mono">
                {whatsPreview || <span className="text-gray-600">Clique em "Atualizar preview" para visualizar</span>}
              </div>
            </div>
          </div>

          {/* Teste real */}
          <div className="border-t border-gray-800 pt-4">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Enviar mensagem de teste real</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={whatsTesteTel}
                onChange={(e) => setWhatsTesteTel(e.target.value)}
                placeholder="(41) 99999-9999"
                className="flex-1 min-w-[200px] bg-[#0d1117] border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-green-500 focus:border-green-500"
              />
              <button
                type="button"
                onClick={enviarTesteWhats}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium cursor-pointer"
              >
                Enviar teste
              </button>
            </div>
            {whatsTesteMsg && (
              <div className={`mt-2 text-xs ${whatsTesteMsg.ok === true ? "text-green-400" : whatsTesteMsg.ok === false ? "text-red-400" : "text-gray-400"}`}>
                {whatsTesteMsg.msg}
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              O teste usa o template atual (ainda não salvo) renderizado com dados fictícios.
            </p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function lightenColor(hex, percent) {
  try {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * percent / 100));
    const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100));
    const b = Math.min(255, (num & 0x0000FF) + Math.round(255 * percent / 100));
    return `rgb(${r}, ${g}, ${b})`;
  } catch (e) {
    return '#93c5fd';
  }
}
