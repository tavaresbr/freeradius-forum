import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Login from "./pages/admin/Login";
import Dashboard from "./pages/admin/Dashboard";
import Mikrotiks from "./pages/admin/Mikrotiks";
import Planos from "./pages/admin/Planos";
import Configuracoes from "./pages/admin/Configuracoes";
import Pagamentos from "./pages/admin/Pagamentos";
import UsuariosRadius from "./pages/admin/UsuariosRadius";
import LgpdCadastros from "./pages/admin/LgpdCadastros";
import Sessoes from "./pages/admin/Sessoes";
import SessoesLog from "./pages/admin/SessoesLog";
import Logs from "./pages/admin/Logs";
import Usuarios from "./pages/admin/Usuarios";
import Wireguard from "./pages/admin/Wireguard";
import Portais from "./pages/admin/Portais";
import PortalEditor from "./pages/admin/PortalEditor";
import Leads from "./pages/admin/Leads";
import ImportarClientes from "./pages/admin/ImportarClientes";
import Integracoes from "./pages/admin/Integracoes";
import DominioProprio from "./pages/admin/DominioProprio";
import IntegracaoSgp from "./pages/admin/IntegracaoSgp";
import IntegracaoMercadoPago from "./pages/admin/IntegracaoMercadoPago";
import Compliance from "./pages/admin/Compliance";
import EmpresasAdmin from "./pages/admin/EmpresasAdmin";
import Assinatura from "./pages/admin/Assinatura";
import PlanosSaas from "./pages/admin/PlanosSaas";
import GruposPermissao from "./pages/admin/GruposPermissao";
import WhatsApp from "./pages/admin/WhatsApp";
import PromocoesWhatsapp from "./pages/admin/PromocoesWhatsapp";
import Vouchers from "./pages/admin/Vouchers";
import Voucher from "./pages/public/Voucher";
import Campanhas from "./pages/admin/Campanhas";
import TutorialOmada from "./pages/admin/TutorialOmada";
import TutorialGrandstream from "./pages/admin/TutorialGrandstream";
import TutorialUnifi from "./pages/admin/TutorialUnifi";
import CampanhaEditor from "./pages/admin/CampanhaEditor";
import Empresas from "./pages/super/Empresas";
import SuperDashboard from "./pages/super/SuperDashboard";
import Backups from "./pages/super/Backups";
import AtualizarSistema from "./pages/super/AtualizarSistema";
import PublicarAtualizacao from "./pages/super/PublicarAtualizacao";

import PlanosCliente from "./pages/public/PlanosCliente";
import Pagamento from "./pages/public/Pagamento";
import LgpdAuto from "./pages/public/LgpdAuto";
import CadastroLGPD from "./pages/public/CadastroLGPD";
import CadastroLead from "./pages/public/CadastroLead";
import CadastroLeadPassivo from "./pages/public/CadastroLeadPassivo";
import CadastroCliente from "./pages/public/CadastroCliente";
import Registro from "./pages/public/Registro";
import CampanhaPlayer from "./pages/public/CampanhaPlayer";
import LoginHotspot from "./pages/public/LoginHotspot";
import ApexHome from "./pages/public/ApexHome";

// Componente de proteção
const RotaPrivada = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  return children;
};

// Areas da plataforma (SaaS, empresas, atualizacao, logs): so o dono da plataforma
const RotaDono = ({ children }) => {
  const { user, loading, donoPlataforma, donoCarregando } = useAuth();
  if (loading || donoCarregando) return null;
  if (!user) return <Navigate to="/login" />;
  if (!donoPlataforma) return <Navigate to={`/admin/${user.empresa_slug}`} replace />;
  return children;
};

// Redireciona /admin para /admin/:slug
const AdminRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  return <Navigate to={`/admin/${user.empresa_slug}`} replace />;
};

function App() {
  return (
    <Routes>
      {/* Público */}
      <Route path="/" element={<ApexHome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro-cliente" element={<CadastroCliente />} />
      <Route path="/planos-cliente" element={<PlanosCliente />} />
      <Route path="/pagamento/:id" element={<Pagamento />} />
      <Route path="/lgpd" element={<LgpdAuto />} />
      <Route path="/cadastro" element={<CadastroLGPD />} />
      <Route path="/lead" element={<CadastroLead />} />
      <Route path="/voucher" element={<Voucher />} />
      <Route path="/lead-passivo" element={<CadastroLeadPassivo />} />
      <Route path="/login-hotspot" element={<LoginHotspot />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/campanha/:portalId" element={<CampanhaPlayer />} />

      {/* Redirect /admin -> /admin/:slug */}
      <Route path="/admin" element={<AdminRedirect />} />

      {/* Admin (protegidas com empresa slug) */}
      <Route path="/admin/:empresaSlug" element={<RotaPrivada><Dashboard /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/empresas" element={<RotaDono><EmpresasAdmin /></RotaDono>} />
      <Route path="/admin/:empresaSlug/assinatura" element={<RotaPrivada><Assinatura /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/planos-saas" element={<RotaDono><PlanosSaas /></RotaDono>} />
      <Route path="/admin/:empresaSlug/mikrotiks" element={<RotaPrivada><Mikrotiks /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/vpn" element={<RotaPrivada><Wireguard /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/tutorial-omada" element={<RotaPrivada><TutorialOmada /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/tutorial-grandstream" element={<RotaPrivada><TutorialGrandstream /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/tutorial-unifi" element={<RotaPrivada><TutorialUnifi /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/portais" element={<RotaPrivada><Portais /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/portais/:portalId/editor" element={<RotaPrivada><PortalEditor /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/planos" element={<RotaPrivada><Planos /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/configuracoes" element={<RotaPrivada><Configuracoes /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/pagamentos" element={<RotaPrivada><Pagamentos /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/radius" element={<RotaPrivada><UsuariosRadius /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/lgpd" element={<RotaPrivada><LgpdCadastros /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/sessoes" element={<RotaPrivada><Sessoes /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/sessoeslog" element={<RotaPrivada><SessoesLog /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/logs" element={<RotaDono><Logs /></RotaDono>} />
      <Route path="/admin/:empresaSlug/leads" element={<RotaPrivada><Leads /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/importar-clientes" element={<RotaPrivada><ImportarClientes /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/dominio" element={<RotaPrivada><DominioProprio /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/integracoes" element={<RotaPrivada><Integracoes /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/integracoes/sgp" element={<RotaPrivada><IntegracaoSgp /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/integracoes/mercado-pago" element={<RotaPrivada><IntegracaoMercadoPago /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/compliance" element={<RotaPrivada><Compliance /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/usuarios" element={<RotaPrivada><Usuarios /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/grupos-permissao" element={<RotaPrivada><GruposPermissao /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/whatsapp" element={<RotaPrivada><WhatsApp /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/vouchers" element={<RotaPrivada><Vouchers /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/promocoes-whatsapp" element={<RotaPrivada><PromocoesWhatsapp /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/campanhas" element={<RotaPrivada><Campanhas /></RotaPrivada>} />
      <Route path="/admin/:empresaSlug/campanhas/:id" element={<RotaPrivada><CampanhaEditor /></RotaPrivada>} />

      {/* Super Admin */}
      <Route path="/super" element={<RotaDono><SuperDashboard /></RotaDono>} />
      <Route path="/super/empresas" element={<RotaDono><Empresas /></RotaDono>} />
      <Route path="/super/atualizar" element={<RotaDono><AtualizarSistema /></RotaDono>} />
      <Route path="/super/backups" element={<RotaDono><Backups /></RotaDono>} />
      <Route path="/super/publicar-atualizacao" element={<RotaDono><PublicarAtualizacao /></RotaDono>} />
    </Routes>
  );
}

export default App;
