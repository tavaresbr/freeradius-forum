import React, { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";
import Atendimento from "./Atendimento";
import PromocoesWhatsapp from "./PromocoesWhatsapp";
import AvisoOperacional from "./AvisoOperacional";
import AtendimentoRelatorios from "./AtendimentoRelatorios";
import Contatos from "../../components/admin/atendimento/Contatos";
import Regua from "../../components/admin/atendimento/Regua";
import Modelos from "../../components/admin/atendimento/Modelos";
import NaoPerturbe from "../../components/admin/atendimento/NaoPerturbe";
import Manutencoes from "../../components/admin/atendimento/Manutencoes";

// Cada aba pede uma permissao de modulo (como a API que ela usa).
const ABAS = [
  { id: "conversas", titulo: "Conversas", modulo: "leads" },
  { id: "contatos", titulo: "Contatos", modulo: "leads" },
  { id: "regua", titulo: "Régua de cobrança", modulo: "configuracoes" },
  { id: "campanhas", titulo: "Campanhas", modulo: "configuracoes" },
  { id: "modelos", titulo: "Modelos", modulo: "leads" },
  { id: "nao-perturbe", titulo: "Não perturbe", modulo: "configuracoes" },
  { id: "relatorios", titulo: "Relatórios", modulo: "leads" },
  { id: "manutencoes", titulo: "Manutenções", modulo: "configuracoes" },
];

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

// Hub do WhatsApp: uma tela com abas (rota /atendimento/:aba). As telas antigas viram abas e continuam com a mesma API.
export default function WhatsAppHub() {
  const { empresaSlug, aba } = useParams();
  const navigate = useNavigate();
  const { hasPermission, isSuperAdmin } = useAuth();
  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const permitidas = ABAS.filter((a) => isSuperAdmin || hasPermission(a.modulo, "ver"));
  const atual = permitidas.find((a) => a.id === aba);
  if (!atual && permitidas.length) {
    return <Navigate to={`/admin/${empresaSlug}/atendimento/${permitidas[0].id}`} replace />;
  }
  if (!atual) return <AdminLayout><p className="text-gray-400">Você não tem permissão para esta área.</p></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-white">WhatsApp</h1>
        <div role="tablist" aria-label="Seções do WhatsApp" className="flex gap-1 overflow-x-auto border-b border-gray-800">
          {permitidas.map((a) => (
            <button key={a.id} role="tab" aria-selected={a.id === atual.id} onClick={() => navigate(`/admin/${empresaSlug}/atendimento/${a.id}`)}
              className={`px-4 py-2 text-sm whitespace-nowrap cursor-pointer border-b-2 -mb-px ${a.id === atual.id ? "border-orange-500 text-white font-medium" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
              {a.titulo}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {atual.id === "conversas" && <Atendimento embutido />}
          {atual.id === "contatos" && <Contatos headers={headers} />}
          {atual.id === "regua" && <Regua headers={headers} />}
          {atual.id === "campanhas" && <Campanhas />}
          {atual.id === "modelos" && <Modelos headers={headers} />}
          {atual.id === "nao-perturbe" && <NaoPerturbe headers={headers} />}
          {atual.id === "manutencoes" && <Manutencoes headers={headers} />}
          {atual.id === "relatorios" && <AtendimentoRelatorios embutido />}
        </div>
      </div>
    </AdminLayout>
  );
}
