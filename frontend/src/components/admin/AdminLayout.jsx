import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function AdminLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { empresaSlug } = useParams();
  const { user, logout, isSuperAdmin, empresas, switchEmpresa, hasPermission } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [switchingEmpresa, setSwitchingEmpresa] = useState(false);
  const [empresaLogo, setEmpresaLogo] = useState(null);
  const [openMenus, setOpenMenus] = useState({});
  const [whatsappStatus, setWhatsappStatus] = useState(null);
  const [whatsappAvisoFechado, setWhatsappAvisoFechado] = useState(false);

  const toggleMenu = (key) => setOpenMenus(prev => ({ ...prev, [key]: !prev[key] }));

  const slug = empresaSlug || user?.empresa_slug || 'default';
  const basePath = `/admin/${slug}`;

  // Buscar logo da empresa ativa
  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`/api/empresas/by-slug/${slug}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setEmpresaLogo(data.logo_url);
        }
      } catch (e) { /* silencioso */ }
    };
    if (slug) fetchLogo();
  }, [slug]);

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
    navigate("/");
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
    ...(isSuperAdmin ? [{
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
      key: "campanhas",
      title: "Campanhas",
      path: `${basePath}/campanhas`,
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
    {
      key: "whatsapp",
      title: "WhatsApp",
      path: `${basePath}/whatsapp`,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 20l1.3-3.9A9 9 0 113.9 18.7L3 20zm9-14a7 7 0 00-5.9 10.7l.3.5-.8 2.3 2.4-.8.5.3A7 7 0 1012 6z"/>
        </svg>
      )
    },
    ...(isSuperAdmin ? [{
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
        if (!child.key || child.key === 'dashboard') return true;
        if (isSuperAdmin) return true;
        if (child.key === 'empresas' || child.key === 'grupos-permissao' || child.key === 'logs') return false;
        return hasPermission(child.key, 'ver');
      });
      return filteredChildren.length > 0 ? { ...item, children: filteredChildren } : null;
    }
    
    if (!item.key || item.key === 'dashboard') return item;
    if (isSuperAdmin) return item;
    if (item.key === 'empresas' || item.key === 'grupos-permissao' || item.key === 'logs') return null;
    return hasPermission(item.key, 'ver') ? item : null;
  }).filter(Boolean);

  const isActive = (path) => {
    if (path === basePath) {
      return location.pathname === basePath;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex bg-[#0f111a]">
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
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          transition-transform duration-300 ease-in-out
          w-72 bg-[#1a1d27] border-r border-gray-800 flex flex-col
          shadow-2xl lg:shadow-none
        `}
      >
        {/* Logo Header */}
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <img src={empresaLogo || '/logo-forum.jpg'} alt="Logo" className="h-12 max-w-[160px] object-contain" />
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-800 text-gray-400"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          {/* Nome do usuário */}
          <div className="mt-2">
            <p className="text-sm text-white font-medium truncate">{user?.nome || user?.email}</p>
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
                className="w-full bg-[#0d1117] border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                {empresas.map(e => (
                  <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-gray-500">
                <span className="text-gray-300 font-medium">{user?.empresa_nome || 'Empresa'}</span>
              </div>
            )}
            {user?.role && (
              <span className="mt-1 inline-block px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-[10px] uppercase">
                {user.role}
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {/* Super Admin link */}
            {isSuperAdmin && (
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
                          ? 'bg-blue-900/10 text-blue-400'
                          : 'text-gray-400 hover:bg-[#252b3b] hover:text-gray-200'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <span className={isChildActive ? 'text-blue-400' : 'text-gray-500'}>
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
                                ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                                : 'text-gray-400 hover:bg-[#252b3b] hover:text-gray-200'
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
                      ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                      : 'text-gray-400 hover:bg-[#252b3b] hover:text-gray-200'
                    }
                  `}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className={isActive(item.path) ? 'text-blue-400' : 'text-gray-500'}>
                    {item.icon}
                  </span>
                  <span className="text-sm">{item.title}</span>
                </Link>
              );
            })}

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-gray-400 hover:bg-red-900/20 hover:text-red-400 transition-all duration-200 mt-2 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
              <span className="text-sm">Sair</span>
            </button>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800">
          <div className="text-center text-xs text-gray-600">
            Desenvolvido por<br/>
            <span className="font-semibold text-gray-400">Forum Telecom</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Bar (Mobile) */}
        <header className="lg:hidden bg-[#1a1d27] border-b border-gray-800 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
            <img src="/logo-forum.jpg" alt="Logo" className="h-8" />
            <div className="w-10" />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 text-gray-300">
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
          {children}
        </main>
      </div>
    </div>
  );
}
