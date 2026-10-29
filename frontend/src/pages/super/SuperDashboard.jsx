import { useState, useEffect, useRef } from "react";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function SuperDashboard() {
  const raizRef = useRef(null);
  useTabelasMobile(raizRef);
  const { user, isSuperAdmin, logout, switchEmpresa } = useAuth();
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate(`/admin/${user?.empresa_slug || 'default'}`);
      return;
    }
    fetchEmpresas();
  }, []);

  const fetchEmpresas = async () => {
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/empresas", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setEmpresas(await res.json());
      }
    } catch (err) {
      console.error("Erro ao buscar empresas:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={raizRef} className="super-pagina min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Painel Super Admin</h1>
            <p className="text-gray-500 mt-1">Gerenciamento da plataforma</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/admin/${user?.empresa_slug || 'default'}`}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm"
            >
              Meu Painel
            </Link>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 text-sm"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6">
            <p className="text-gray-500 text-sm">Total de Empresas</p>
            <p className="text-3xl font-bold text-white mt-1">{empresas.length}</p>
          </div>
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6">
            <p className="text-gray-500 text-sm">Total de MikroTiks</p>
            <p className="text-3xl font-bold text-white mt-1">
              {empresas.reduce((acc, e) => acc + (e.total_mikrotiks || 0), 0)}
            </p>
          </div>
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6">
            <p className="text-gray-500 text-sm">Total de Admins</p>
            <p className="text-3xl font-bold text-white mt-1">
              {empresas.reduce((acc, e) => acc + (e.total_admins || 0), 0)}
            </p>
          </div>
        </div>

        {/* Acoes Rapidas */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link to="/super/empresas" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm">
            Gerenciar Empresas
          </Link>
          <Link to="/super/atualizar" className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 text-sm">
            Atualizar Sistema
          </Link>
          <Link to="/super/backups" className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-500 text-sm">
            Backups
          </Link>
          <Link to="/super/publicar-atualizacao" className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 text-sm">
            Publicar Atualizacao
          </Link>
        </div>

        {/* Empresas List */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Empresas</h2>
        </div>

        {loading ? (
          <p className="text-gray-500">Carregando...</p>
        ) : (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left p-4">Empresa</th>
                  <th className="text-left p-4">Slug</th>
                  <th className="text-center p-4">MikroTiks</th>
                  <th className="text-center p-4">Planos</th>
                  <th className="text-center p-4">Admins</th>
                  <th className="text-center p-4">Status</th>
                  <th className="text-center p-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-[#252b3b]">
                    <td className="p-4 font-medium text-white">{e.nome}</td>
                    <td className="p-4 text-gray-400">{e.slug}</td>
                    <td className="p-4 text-center">{e.total_mikrotiks || 0}</td>
                    <td className="p-4 text-center">{e.total_planos || 0}</td>
                    <td className="p-4 text-center">{e.total_admins || 0}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded text-xs ${e.ativo ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                        {e.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="p-4 text-center whitespace-nowrap">
                      <Link
                        to={`/super/empresas?editar=${e.id}`}
                        className="text-yellow-400 hover:text-yellow-300 text-sm mr-4"
                      >
                        Cadastro
                      </Link>
                      <button
                        onClick={async () => {
                          try {
                            await switchEmpresa(e.id);
                            window.location.href = `/admin/${e.slug}`;
                          } catch (err) {
                            window.location.href = `/admin/${e.slug}`;
                          }
                        }}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Acessar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
