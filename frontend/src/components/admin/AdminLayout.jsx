import RecursoBloqueado from "./RecursoBloqueado";
import React, { useState, useEffect, useRef } from "react";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import MarcaApex from "../public/MarcaApex";
import ToggleTema from "../ToggleTema";
import { avisoAtivo, tocarAviso, notificar } from "../../utils/avisoWhatsapp";

export default function AdminLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { empresaSlug } = useParams();
  const { user, logout, isSuperAdmin, donoPlataforma, empresas, switchEmpresa, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);
  const [switchingEmpresa, setSwitchingEmpresa] = useState(false);
  const [openMenus, setOpenMenus] = useState({});
  const [whatsappStatus, setWhatsappStatus] = useState(null);
  const [whatsappAvisoFechado, setWhatsappAvisoFechado] = useState(false);
  const [assinatura, setAssinatura] = useState(null);
  const [naoLidasWa, setNaoLidasWa] = useState(0);
  const totalWaRef = useRef(null); // total de mensagens nao lidas na ultima consulta (null = ainda nao consultou)

  const toggleMenu = (key) => setOpenMenus(prev => ({ ...prev, [key]: !prev[key] }));

  const slug = empresaSlug || user?.empresa_slug || 'default';
  const basePath = `/admin/${slug}`;
  const mainRef = useRef(null);
  useTabelasMobile(mainRef);

  // SaaS: status da assinatura da empresa (super admin nunca e' bloqueado).
  // Vencida alem da carencia -> so a tela de Assinatura fica acessivel.
  useEffect(() => {
    if (isSuperAdmin || !user) return;
    let ativo = true;
    fetch('/api/assinatura/status', { headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (ativo && d) setAssinatura(d); })
      .catch(() => {});
    return () => { ativo = false; };
  }, [isSuperAdmin, user, location.pathname]);

  // Celular: a gaveta fecha ao navegar por um item do menu.
  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [location.pathname]);

  const naTelaAssinatura = location.pathname.startsWith(`${basePath}/assinatura`);

  // SaaS Fase 2: tela de recurso que o plano/adicionais nao incluem (super admin nunca e' bloqueado).
  const rota = location.pathname.slice(basePath.length);
  const recursoDaRota = /^\/(whatsapp|promocoes-whatsapp|aviso-operacional|atendimento)(\/|$)/.test(rota) ? ["whatsapp", "WhatsApp"]
    : /^\/campanhas(\/|$)/.test(rota) ? ["campanhas", "Campanhas"]
    : /^\/dominio(\/|$)/.test(rota) ? ["dominio", "Domínio próprio"] : null;
  const recursoBloqueado = !isSuperAdmin && recursoDaRota && assinatura?.recursos?.[recursoDaRota[0]] === false ? recursoDaRota[1] : null;
  useEffect(() => {
    if (assinatura?.bloqueada && !naTelaAssinatura) navigate(`${basePath}/assinatura`, { replace: true });
  }, [assinatura, naTelaAssinatura, basePath]);


  // Atendimento WhatsApp: contador de conversas nao lidas no menu (so com o recurso e a permissao)
  const podeAtendimento = isSuperAdmin || (assinatura?.recursos?.whatsapp !== false && hasPermission('leads', 'ver'));
  useEffect(() => {
    if (!slug || !podeAtendimento) { setNaoLidasWa(0); return; }
    let ativo = true;
    const buscar = async () => {
      // aba em segundo plano so consulta se o aviso (som/notificacao) estiver ligado
      if (document.hidden && !avisoAtivo()) return;
      try {
        const res = await fetch('/api/atendimento/nao-lidas', { headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` } });
        if (!res.ok || !ativo) return;
        const d = await res.json();
        setNaoLidasWa(d.conversas || 0);
        const total = d.mensagens || 0;
        if (totalWaRef.current !== null && total > totalWaRef.current && avisoAtivo()) {
          tocarAviso();
          notificar('WhatsApp', total === 1 ? '1 mensagem nova' : `${total} mensagens não lidas`);
        }
        totalWaRef.current = total;
      } catch (e) { /* silencioso */ }
    };
    buscar();
    const t = setInterval(buscar, 15000);
    return () => { ativo = false; clearInterval(t); };
  }, [slug, podeAtendimento, location.pathname]);

  // Verificar status do WhatsApp para exibir aviso se desconectado
  useEffect(() => {
    const fetchWhatsappStatus = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch('/api/whatsapp/instance/status', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setWhatsappStatus(data);
        }
      } catch (e) { /* silencioso */ }
    };
    // Reset do aviso ao trocar de empresa
    setWhatsappAvisoFechado(sessionStorage.getItem(`wa_aviso_fechado_${slug}`) === '1');
    if (slug) fetchWhatsappStatus();
  }, [slug]);

  const fecharAvisoWhatsapp = () => {
    setWhatsappAvisoFechado(true);
    sessionStorage.setItem(`wa_aviso_fechado_${slug}`, '1');
  };

  const whatsappDesconectado = whatsappStatus && (!whatsappStatus.exists || whatsappStatus.state !== 'open');
  const mostrarAvisoWhatsapp = whatsappDesconectado && !whatsappAvisoFechado && !location.pathname.includes('/whatsapp');

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const menuItems = [
    {
      key: "dashboard",
      title: "Dashboard",
      path: basePath,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
        </svg>
      )
    },
    {
      key: "leads",
      title: "WhatsApp",
      path: `${basePath}/atendimento`,
      badge: naoLidasWa,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
      )
    },
    {
      key: "assinatura",
      title: "Assinatura",
      path: `${basePath}/assinatura`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
        </svg>
      )
    },
    ...(donoPlataforma ? [{
      key: "planos-saas",
      title: "Planos SaaS",
      path: `${basePath}/planos-saas`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
        </svg>
      )
    }] : []),
    ...(donoPlataforma ? [{
      key: "identidade-plataforma",
      title: "Identidade da plataforma",
      path: `${basePath}/identidade-plataforma`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      )
    }] : []),
    ...(donoPlataforma ? [{
      key: "empresas",
      title: "Empresas",
      path: `${basePath}/empresas`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
        </svg>
      )
    }] : []),
    {
      key: "mikrotik_group",
      title: "Equipamentos",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/>
        </svg>
      ),
      children: [
        { key: "mikrotiks", title: "Cadastro de equipamento", path: `${basePath}/mikrotiks` },
        { key: "vpn", title: "VPN Wireguard", path: `${basePath}/vpn` },
      ]
    },
    {
      key: "portais",
      title: "Portais",
      path: `${basePath}/portais`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"/>
        </svg>
      )
    },
    {
      key: "portais",
      title: "Vouchers",
      path: `${basePath}/vouchers`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
        </svg>
      )
    },
    {
      key: "marketing_group",
      title: "Marketing",
      children: [
        { key: "portais", title: "Campanhas", path: `${basePath}/campanhas` },
        { key: "configuracoes", title: "Promoções WhatsApp", path: `${basePath}/atendimento/campanhas` },
        { key: "configuracoes", title: "Cupons", path: `${basePath}/cupons` },
      ],
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
        </svg>
      )
    },
    {
      key: "planos",
      title: "Planos",
      path: `${basePath}/planos`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
        </svg>
      )
    },
    {
      key: "pagamentos",
      title: "Pagamentos",
      path: `${basePath}/pagamentos`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h2m3 0h2m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
        </svg>
      )
    },
    {
      key: "clientes_group",
      title: "Clientes",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
        </svg>
      ),
      children: [
        { key: "clientes", title: "Cadastro LGPD", path: `${basePath}/lgpd` },
        { key: "leads", title: "Clientes / Leads", path: `${basePath}/leads` },
        { key: "leads", title: "Importar clientes", path: `${basePath}/importar-clientes` },
      ]
    },
    {
      key: "radius_group",
      title: "Radius",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
        </svg>
      ),
      children: [
        { key: "radius", title: "Usuários Radius", path: `${basePath}/radius` },
        { key: "sessoes", title: "Sessões Ativas", path: `${basePath}/sessoes` },
        { key: "sessoeslog", title: "Log Radius", path: `${basePath}/sessoeslog` },
        { key: "compliance", title: "Marco Civil", path: `${basePath}/compliance` },
      ]
    },
    ...(donoPlataforma ? [{
      key: "logs",
      title: "Logs do Sistema",
      path: `${basePath}/logs`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      )
    }] : []),
    {
      key: "configuracoes_group",
      title: "Configurações",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      ),
      children: [
        { key: "configuracoes", title: "Configurações", path: `${basePath}/configuracoes` },
        { key: "configuracoes", title: "Integrações", path: `${basePath}/integracoes` },
        { key: "configuracoes", title: "Domínio próprio", path: `${basePath}/dominio` },
        { key: "configuracoes", title: "Auditoria", path: `${basePath}/auditoria` },
        { key: "usuarios", title: "Usuários", path: `${basePath}/usuarios` },
        ...(isSuperAdmin ? [{ key: "grupos-permissao", title: "Permissões", path: `${basePath}/grupos-permissao` }] : []),
      ]
    },
    {
      key: "documentacao_group",
      title: "Documentação",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
      ),
      children: [
        // Sem `key` de proposito: child sem key passa no filtro de permissoes (visivel a todos)
        { title: "Tutorial Omada", path: `${basePath}/tutorial-omada` },
        { title: "Tutorial Grandstream", path: `${basePath}/tutorial-grandstream` },
        { title: "Tutorial UniFi", path: `${basePath}/tutorial-unifi` },
      ]
    },
  ];

  // Filtrar menu por permissões
  const filteredMenuItems = menuItems.map(item => {
    if (item.children) {
      const filteredChildren = item.children.filter(child => {
        if (!child.key || child.key === 'dashboard' || child.key === 'assinatura') return true;
        if (isSuperAdmin) return true;
        if (child.key === 'empresas' || child.key === 'planos-saas' || child.key === 'identidade-plataforma' || child.key === 'grupos-permissao' || child.key === 'logs') return false;
        return hasPermission(child.key, 'ver');
      });
      return filteredChildren.length > 0 ? { ...item, children: filteredChildren } : null;
    }
    
    if (!item.key || item.key === 'dashboard' || item.key === 'assinatura') return item;
    if (isSuperAdmin) return item;
    if (item.key === 'empresas' || item.key === 'planos-saas' || item.key === 'identidade-plataforma' || item.key === 'grupos-permissao' || item.key === 'logs') return null;
    return hasPermission(item.key, 'ver') ? item : null;
  }).filter(Boolean);

  const isActive = (path) => {
    if (path === basePath) {
      return location.pathname === basePath;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="painel min-h-screen flex bg-[#0f111a]">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
          transition-transform duration-300 ease-in-out
          tema-site w-72 bg-white border-r border-apex-100 flex flex-col
          lg:shadow-none
        `}
      >
        {/* Logo Header */}
        <div className="p-6 border-b border-apex-100">
          <div className="flex items-center justify-between">
            <MarcaApex className="text-lg" local="painel" empresa={slug} />
            <ToggleTema className="hidden lg:block text-gray-600" />
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 rounded-lg hover:bg-apex-50 text-gray-500"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          {/* Nome do usuário */}
          <div className="mt-2">
            <p className="text-sm text-apex-900 font-medium truncate">{user?.nome || user?.email}</p>
            {user?.nome && <p className="text-[11px] text-gray-500 truncate">{user?.email}</p>}
          </div>
          {/* Empresa switcher */}
          <div className="mt-3">
            {empresas.length > 1 ? (
              <select
                value={user?.empresa_id || ''}
                disabled={switchingEmpresa}
                onChange={async (e) => {
                  const newId = parseInt(e.target.value);
                  if (newId === user?.empresa_id) return;
                  setSwitchingEmpresa(true);
                  try {
                    const emp = await switchEmpresa(newId);
                    window.location.href = `/admin/${emp.slug}`;
                  } catch (err) {
                    alert('Erro ao trocar empresa');
                  } finally {
                    setSwitchingEmpresa(false);
                  }
                }}
                className="w-full bg-white border border-gray-300 text-gray-700 text-xs rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-apex-500 focus:border-apex-500"
              >
                {empresas.map(e => (
                  <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-gray-500">
                <span className="text-gray-700 font-medium">{user?.empresa_nome || 'Empresa'}</span>
              </div>
            )}
            {user?.role && (
              <span className="mt-1 inline-block px-2 py-0.5 bg-apex-100 text-apex-700 rounded text-[10px] uppercase">
                {user.role}
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {/* Super Admin link */}
            {donoPlataforma && (
              <Link
                to="/super"
                className="flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-yellow-400 hover:bg-yellow-900/20 transition-all duration-200 mb-2 border border-yellow-800/30"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
                <span className="text-sm">Painel Super Admin</span>
              </Link>
            )}

            {filteredMenuItems.map((item) => {
              if (item.children) {
                const isOpen = openMenus[item.key] || false;
                const isChildActive = item.children.some(child => isActive(child.path));

                return (
                  <div key={item.key} className="mb-1">
                    <button
                      onClick={() => toggleMenu(item.key)}
                      className={`
                        w-full flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-all duration-200 cursor-pointer
                        ${isChildActive
                          ? 'bg-apex-50 text-apex-700'
                          : 'text-gray-600 hover:bg-apex-50 hover:text-apex-900'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <span className={isChildActive ? 'text-apex-600' : 'text-gray-500'}>
                          {item.icon}
                        </span>
                        <span className="text-sm">{item.title}</span>
                      </div>
                      <svg className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-1 pl-11 pr-2 mt-1">
                        {item.children.map(child => (
                          <Link
                            key={child.path}
                            to={child.path}
                            className={`
                              block px-3 py-2 rounded-lg text-sm transition-all duration-200 cursor-pointer
                              ${isActive(child.path)
                                ? 'bg-apex-100 text-apex-700 border border-apex-200'
                                : 'text-gray-600 hover:bg-apex-50 hover:text-apex-900'
                              }
                            `}
                            onClick={() => setSidebarOpen(false)}
                          >
                            {child.title}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              // Rendering normal menu item
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200 cursor-pointer mb-1
                    ${isActive(item.path)
                      ? 'bg-apex-100 text-apex-700 border border-apex-200'
                      : 'text-gray-600 hover:bg-apex-50 hover:text-apex-900'
                    }
                  `}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className={isActive(item.path) ? 'text-apex-600' : 'text-gray-500'}>
                    {item.icon}
                  </span>
                  <span className="text-sm">{item.title}</span>
                  {item.badge > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-green-600 text-white text-xs font-semibold flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all duration-200 mt-2 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
              <span className="text-sm">Sair</span>
            </button>
          </div>
        </nav>

      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top Bar (Mobile) */}
        <header className="tema-site lg:hidden bg-white border-b border-apex-100 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-apex-50 text-gray-500 cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
            <MarcaApex className="text-base" local="painel" empresa={slug} />
            <ToggleTema className="text-gray-600" />
          </div>
        </header>

        {/* Page Content */}
        <main ref={mainRef} className="flex-1 min-w-0 p-4 lg:p-8 text-gray-300">
          {mostrarAvisoWhatsapp && (
            <div className="mb-4 bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <div className="flex-1 text-sm">
                <strong className="font-semibold">WhatsApp desconectado.</strong>{" "}
                {whatsappStatus?.exists
                  ? "A instância não está conectada. Mensagens automáticas não serão enviadas."
                  : "Nenhuma instância configurada para esta empresa."}{" "}
                <Link to={`${basePath}/whatsapp`} className="underline font-medium hover:text-yellow-100">
                  Configurar agora
                </Link>
              </div>
              <button
                onClick={fecharAvisoWhatsapp}
                className="text-yellow-400 hover:text-yellow-200 flex-shrink-0"
                aria-label="Fechar aviso"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          )}
          {assinatura && !assinatura.gratis && !assinatura.bloqueada && !naTelaAssinatura && (assinatura.status === 'trial' || assinatura.em_carencia || assinatura.dias_restantes <= 5) && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-blue-900/20 border border-blue-700/40 text-blue-200 rounded-xl px-4 py-3 text-sm">
              <span>
                {assinatura.em_carencia
                  ? 'Sua assinatura venceu. Renove para não perder o acesso ao painel.'
                  : assinatura.status === 'trial'
                    ? `Período de teste: ${Math.max(assinatura.dias_restantes, 0)} dia(s) restante(s).`
                    : `Sua assinatura vence em ${Math.max(assinatura.dias_restantes, 0)} dia(s).`}
              </span>
              <Link to={`${basePath}/assinatura`} className="font-semibold underline whitespace-nowrap">Ver assinatura</Link>
            </div>
          )}
          {recursoBloqueado ? <RecursoBloqueado titulo={recursoBloqueado} basePath={basePath} /> : children}
        </main>
      </div>
    </div>
  );
}
