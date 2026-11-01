import React, { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bell, BellOff, Settings } from "lucide-react";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";
import { avisoAtivo, definirAviso, pedirPermissaoNotificacao, tocarAviso } from "../../utils/avisoWhatsapp";
import Atendimento from "./Atendimento";
import PromocoesWhatsapp from "./PromocoesWhatsapp";
import AvisoOperacional from "./AvisoOperacional";
import AtendimentoRelatorios from "./AtendimentoRelatorios";
import Contatos from "../../components/admin/atendimento/Contatos";
import Leads from "./Leads";
import LgpdCadastros from "./LgpdCadastros";
import ImportarClientes from "./ImportarClientes";
import Regua from "../../components/admin/atendimento/Regua";
import Modelos from "../../components/admin/atendimento/Modelos";
import NaoPerturbe from "../../components/admin/atendimento/NaoPerturbe";
import Manutencoes from "../../components/admin/atendimento/Manutencoes";
import AlertasTecnicos from "../../components/admin/atendimento/AlertasTecnicos";
import Indicacoes from "../../components/admin/atendimento/Indicacoes";

// Cada aba pede uma permissao de modulo (como a API que ela usa).
const ABAS = [
  { id: "conversas", titulo: "Conversas", modulo: "leads" },
  { id: "contatos", titulo: "Contatos", modulo: "leads" },
  { id: "regua", titulo: "Régua de cobrança", modulo: "configuracoes" },
  { id: "campanhas", titulo: "Campanhas", modulo: "configuracoes" },
  { id: "indicacoes", titulo: "Indicações", modulo: "configuracoes" },
  { id: "modelos", titulo: "Modelos", modulo: "leads" },
  { id: "nao-perturbe", titulo: "Não perturbe", modulo: "configuracoes" },
  { id: "relatorios", titulo: "Relatórios", modulo: "leads" },
  { id: "manutencoes", titulo: "Manutenções", modulo: "configuracoes" },
  { id: "alertas", titulo: "Alertas técnicos", modulo: "configuracoes" },
];

function ContatosAbas({ headers }) {
  const [sub, setSub] = useState("todos");
  const subs = [["todos", "Todos os contatos"], ["clientes", "Clientes / Leads"], ["lgpd", "Cadastro LGPD"], ["importar", "Importar clientes"]];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {subs.map(([id, titulo]) => (
          <button key={id} onClick={() => setSub(id)} aria-pressed={sub === id}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${sub === id ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{titulo}</button>
        ))}
      </div>
      {sub === "todos" && <Contatos headers={headers} />}
      {sub === "clientes" && <Leads embutido />}
      {sub === "lgpd" && <LgpdCadastros embutido />}
      {sub === "importar" && <ImportarClientes embutido />}
    </div>
  );
}

function Campanhas() {
  const [searchParams] = useSearchParams();
  const [sub, setSub] = useState(searchParams.get("sub") === "aviso" ? "aviso" : "promocoes");
  const subs = [["promocoes", "Promoções"], ["aviso", "Aviso agora (quem está conectado)"]];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {subs.map(([id, titulo]) => (
          <button key={id} onClick={() => setSub(id)} aria-pressed={sub === id}
            className={`px-3 py-1 rounded-full text-xs cursor-pointer border ${sub === id ? "bg-blue-600 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-[#252b3b]"}`}>{titulo}</button>
        ))}
      </div>
      {sub === "promocoes" ? <PromocoesWhatsapp embutido /> : <AvisoOperacional embutido />}
    </div>
  );
}


// Cantinho direito da barra de abas: sino (aviso de mensagem nova) e engrenagem (configuracoes do atendimento).
function AcoesDoCanto({ onAcao, empresaSlug }) {
  const [aviso, setAviso] = useState(avisoAtivo());
  const [aberto, setAberto] = useState(false);
  const caixa = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const alternarAviso = async () => {
    const novo = !aviso;
    setAviso(novo);
    definirAviso(novo);
    if (novo) { tocarAviso(); await pedirPermissaoNotificacao(); }
  };
  const itemCls = "block w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-[#252b3b] cursor-pointer";
  const escolher = (modal) => { setAberto(false); onAcao(modal); };

  return (
    <div className="flex items-center gap-1 pl-2 shrink-0" ref={caixa}>
      <button onClick={alternarAviso} aria-pressed={aviso} aria-label={aviso ? "Desligar aviso de mensagem nova" : "Ligar aviso de mensagem nova"}
        title={aviso ? "Aviso de mensagem nova ligado (clique para desligar)" : "Aviso de mensagem nova desligado (clique para ligar)"}
        className={`p-2 rounded-lg cursor-pointer hover:bg-[#252b3b] ${aviso ? "text-orange-500" : "text-gray-500"}`}>
        {aviso ? <Bell size={18} /> : <BellOff size={18} />}
      </button>
      <div className="relative">
        <button onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto} aria-label="Configurações do atendimento" title="Configurações do atendimento"
          className="p-2 rounded-lg cursor-pointer text-gray-300 hover:bg-[#252b3b]">
          <Settings size={18} />
        </button>
        {aberto && (
          <div role="menu" className="absolute right-0 top-full mt-1 w-64 bg-[#1a1d27] border border-gray-800 rounded-lg shadow-xl z-40 py-1">
            <button role="menuitem" className={`${itemCls} text-green-400`} onClick={() => escolher("nova")}>Nova conversa</button>
            <button role="menuitem" className={itemCls} onClick={() => escolher("automacao")}>Resposta automática</button>
            <button role="menuitem" className={itemCls} onClick={() => escolher("chatbot")}>Chatbot</button>
            <button role="menuitem" className={itemCls} onClick={() => escolher("etiquetas")}>Etiquetas</button>
            <Link to={`/admin/${empresaSlug}/whatsapp`} role="menuitem" className={`${itemCls} border-t border-gray-800`} onClick={() => setAberto(false)}>Conexão e histórico de envios</Link>
          </div>
        )}
      </div>
    </div>
  );
}

// Hub do WhatsApp: uma tela com abas (rota /atendimento/:aba). As telas antigas viram abas e continuam com a mesma API.
export default function WhatsAppHub() {
  const { empresaSlug, aba } = useParams();
  const navigate = useNavigate();
  const { hasPermission, isSuperAdmin } = useAuth();
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const [pedido, setPedido] = useState(null); // acao da engrenagem a abrir na aba Conversas
  const temConversas = ABAS.some((a) => a.id === "conversas") && (isSuperAdmin || hasPermission("leads", "ver"));
  const pedirAcao = (modal) => {
    setPedido({ modal, n: Date.now() });
    if (aba !== "conversas") navigate(`/admin/${empresaSlug}/atendimento/conversas`);
  };

  const permitidas = ABAS.filter((a) => isSuperAdmin || hasPermission(a.modulo, "ver"));
  const atual = permitidas.find((a) => a.id === aba);
  if (!atual && permitidas.length) {
    return <Navigate to={`/admin/${empresaSlug}/atendimento/${permitidas[0].id}`} replace />;
  }
  if (!atual) return <AdminLayout><p className="text-gray-400">Você não tem permissão para esta área.</p></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-3">
        <h1 className="sr-only">WhatsApp</h1>
        <div className="flex items-center border-b border-gray-800">
          <div role="tablist" aria-label="Seções do WhatsApp" className="flex justify-start gap-0 overflow-x-auto overflow-y-hidden flex-1 min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {permitidas.map((a) => (
              <button key={a.id} role="tab" aria-selected={a.id === atual.id} onClick={() => navigate(`/admin/${empresaSlug}/atendimento/${a.id}`)}
                className={`px-2.5 py-2 text-sm whitespace-nowrap cursor-pointer border-b-2 -mb-px ${a.id === atual.id ? "border-orange-500 text-white font-medium" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
                {a.titulo}
              </button>
            ))}
          </div>
          {temConversas && <AcoesDoCanto empresaSlug={empresaSlug} onAcao={pedirAcao} />}
        </div>
        <div role="tabpanel">
          {atual.id === "conversas" && <Atendimento embutido pedido={pedido} onPedidoTratado={() => setPedido(null)} />}
          {atual.id === "contatos" && <ContatosAbas headers={headers} />}
          {atual.id === "regua" && <Regua headers={headers} />}
          {atual.id === "campanhas" && <Campanhas />}
          {atual.id === "indicacoes" && <Indicacoes headers={headers} />}
          {atual.id === "modelos" && <Modelos headers={headers} />}
          {atual.id === "nao-perturbe" && <NaoPerturbe headers={headers} />}
          {atual.id === "manutencoes" && <Manutencoes headers={headers} />}
          {atual.id === "alertas" && <AlertasTecnicos headers={headers} />}
          {atual.id === "relatorios" && <AtendimentoRelatorios embutido />}
        </div>
      </div>
    </AdminLayout>
  );
}
