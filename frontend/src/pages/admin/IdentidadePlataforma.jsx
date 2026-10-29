import AdminLayout from "../../components/admin/AdminLayout";
import IdentidadeSite from "../../components/admin/IdentidadeSite";

// Identidade GLOBAL (padrao da plataforma): so o dono da plataforma. Cada empresa tem a sua em Configuracoes.
export default function IdentidadePlataforma() {
  return (
    <AdminLayout>
      <h1 className="text-2xl font-semibold mb-2">Identidade da plataforma</h1>
      <p className="text-sm text-gray-500 mb-6">Logo, nome e ícones padrão do sistema (site, login e painel). Aparecem para as empresas que ainda não enviaram a identidade delas em Configurações.</p>
      <IdentidadeSite />
    </AdminLayout>
  );
}
