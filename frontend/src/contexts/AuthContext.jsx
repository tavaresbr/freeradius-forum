import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1];
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [empresas, setEmpresas] = useState([]);
  const [permissoes, setPermissoes] = useState({});
  // Dono da plataforma: null = ainda nao sabemos (so super admin consulta)
  const [donoPlataforma, setDonoPlataforma] = useState(null);

  const carregarDono = async (token) => {
    try {
      const res = await fetch('/api/plataforma/eu', { headers: { Authorization: `Bearer ${token}` } });
      const data = res.ok ? await res.json() : {};
      setDonoPlataforma(data.dono === true);
    } catch {
      setDonoPlataforma(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('admin_token');
      if (token) {
        const decoded = parseJwt(token);
        if (decoded && decoded.exp * 1000 > Date.now()) {
          if (decoded.role === 'super_admin') carregarDono(token);
          else setDonoPlataforma(false);
          setUser({
            id: decoded.id,
            email: decoded.email,
            empresa_id: decoded.empresa_id,
            empresa_slug: decoded.empresa_slug || 'default',
            empresa_nome: decoded.empresa_nome,
            role: decoded.role || 'operator',
            nome: localStorage.getItem('user_nome') || null,
          });

          // Restaurar permissões do cache
          const cachedPerms = localStorage.getItem('user_permissoes');
          if (cachedPerms) {
            try { setPermissoes(JSON.parse(cachedPerms)); } catch {}
          }
          
          let loadedEmpresas = null;
          // Carregar empresas do usuário do cache
          const savedEmpresas = localStorage.getItem('user_empresas');
          if (savedEmpresas && savedEmpresas !== 'undefined') {
            try { loadedEmpresas = JSON.parse(savedEmpresas); } catch {}
          }
          
          // Se não tem no cache, busca na API (usuários antigos na transição)
          if (!loadedEmpresas || loadedEmpresas.length === 0) {
            try {
              const res = await fetch('/api/auth/me/empresas', {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (res.ok) {
                loadedEmpresas = await res.json();
                localStorage.setItem('user_empresas', JSON.stringify(loadedEmpresas));
              }
            } catch (e) { console.error('Erro ao buscar empresas:', e); }
          }
          
          if (loadedEmpresas) {
            setEmpresas(loadedEmpresas);
          }
        } else {
          localStorage.removeItem('admin_token');
          localStorage.removeItem('user_empresas');
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const login = (token, userData, empresasList, permissoesData) => {
    localStorage.setItem('admin_token', token);
    const decoded = parseJwt(token);
    if (decoded.role === 'super_admin') { setDonoPlataforma(null); carregarDono(token); }
    else setDonoPlataforma(false);
    setUser({
      id: decoded.id,
      email: decoded.email,
      empresa_id: decoded.empresa_id,
      empresa_slug: decoded.empresa_slug || 'default',
      role: decoded.role || 'operator',
      nome: userData?.nome,
      empresa_nome: userData?.empresa_nome,
    });
    if (userData?.nome) localStorage.setItem('user_nome', userData.nome);
    if (empresasList) {
      setEmpresas(empresasList);
      localStorage.setItem('user_empresas', JSON.stringify(empresasList));
    }
    if (permissoesData) {
      setPermissoes(permissoesData);
      localStorage.setItem('user_permissoes', JSON.stringify(permissoesData));
    }
  };

  const switchEmpresa = async (empresaId) => {
    const token = localStorage.getItem('admin_token');
    try {
      const res = await fetch('/api/auth/switch-empresa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ empresa_id: empresaId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao trocar empresa');

      localStorage.setItem('admin_token', data.token);
      const decoded = parseJwt(data.token);
      setUser(prev => ({
        ...prev,
        empresa_id: decoded.empresa_id,
        empresa_slug: decoded.empresa_slug,
        empresa_nome: data.empresa.nome,
      }));
      if (data.empresas) {
        setEmpresas(data.empresas);
        localStorage.setItem('user_empresas', JSON.stringify(data.empresas));
      }
      return data.empresa;
    } catch (err) {
      console.error('Erro switchEmpresa:', err);
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('user_empresas');
    localStorage.removeItem('user_permissoes');
    localStorage.removeItem('user_nome');
    setUser(null);
    setEmpresas([]);
    setPermissoes({});
    setDonoPlataforma(null);
  };

  const isSuperAdmin = user?.role === 'super_admin';
  const ehDono = isSuperAdmin && donoPlataforma === true;

  const hasPermission = (modulo, acao = 'ver') => {
    if (isSuperAdmin) return true;
    // Sem grupo vinculado = acesso total (backward compatible)
    if (Object.keys(permissoes).length === 0) return true;
    return !!permissoes[modulo]?.[acao];
  };

  return (
    <AuthContext.Provider value={{ user, donoPlataforma: ehDono, donoCarregando: isSuperAdmin && donoPlataforma === null, login, logout, loading, isSuperAdmin, empresas, switchEmpresa, permissoes, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
}
