import React from "react";
import { useNavigate, useParams } from "react-router-dom";

const COR = {
  ok: "bg-green-600 border-green-500 text-white",
  atual: "bg-blue-600 border-blue-400 text-white ring-2 ring-blue-400/40",
  pendente: "bg-transparent border-gray-600 text-gray-400",
  manual: "bg-transparent border-amber-500 text-amber-400",
  na: "bg-transparent border-gray-700 text-gray-600",
  desconhecido: "bg-transparent border-gray-600 text-gray-500",
};

// Aplica o teste ao vivo (status online/offline) sobre a etapa "conectividade".
export function etapasComStatus(trilha, status) {
  if (!trilha) return [];
  return trilha.etapas.map((e) => {
    if (e.chave !== "conectividade") return e;
    if (status === "online") return { ...e, estado: "ok", detalhe: "Equipamento respondeu ao teste." };
    if (status === "offline") return { ...e, estado: "pendente", detalhe: "Sem resposta. Confira VPN, IP e credenciais." };
    return { ...e, estado: "desconhecido", detalhe: "Verificando..." };
  });
}

export function progresso(trilha, status) {
  const etapas = etapasComStatus(trilha, status).filter((e) => e.estado !== "na");
  const ok = etapas.filter((e) => e.estado === "ok").length;
  return { ok, total: etapas.length, completo: etapas.length > 0 && ok === etapas.length };
}

export default function TrilhaAtivacao({ trilha, status, onTestar, onHotspot, onEditar }) {
  const navigate = useNavigate();
  const { empresaSlug } = useParams();
  const etapas = etapasComStatus(trilha, status);
  if (!trilha) return <p className="text-sm text-gray-500">Carregando trilha...</p>;
  const { ok, total, completo } = progresso(trilha, status);
  const idxAtual = etapas.findIndex((e) => e.estado === "pendente");

  const acionar = (e) => {
    if (e.acao === "testar") onTestar?.();
    else if (e.acao === "hotspot") onHotspot?.();
    else if (e.acao === "editar") onEditar?.();
    else if (e.acao === "planos") navigate(`/admin/${empresaSlug}/planos`);
    else if (e.acao === "tutorial" && e.tutorial) navigate(`/admin/${empresaSlug}/${e.tutorial}`);
  };
  const rotuloAcao = { testar: "Testar agora", hotspot: "Enviar hotspot", editar: "Editar equipamento", planos: "Ir para Planos", tutorial: "Abrir tutorial" };

  return (
    <div className="rounded-lg border border-gray-800 bg-[#151821] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-sm font-semibold text-white">
          {completo ? "✓ Equipamento ativo" : "Trilha de ativação"}
        </span>
        <span className="text-xs text-gray-400">{ok} de {total} etapas</span>
      </div>
      <div className="h-1.5 rounded bg-gray-800 mb-4 overflow-hidden">
        <div className="h-full bg-green-600 transition-all" style={{ width: `${total ? (ok / total) * 100 : 0}%` }} />
      </div>
      <ol className="space-y-2">
        {etapas.map((e, i) => {
          const atual = i === idxAtual;
          const cls = atual ? COR.atual : COR[e.estado] || COR.pendente;
          return (
            <li key={e.chave} className="flex items-start gap-3">
              <span className={`mt-0.5 h-6 w-6 shrink-0 rounded-full border text-xs flex items-center justify-center font-semibold ${cls}`}>
                {e.estado === "ok" ? "✓" : e.estado === "na" ? "–" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${e.estado === "ok" ? "text-gray-300" : "text-white"} ${e.estado === "na" ? "line-through text-gray-600" : ""}`}>{e.titulo}</span>
                  {e.estado === "manual" && <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-600/60 text-amber-400">manual</span>}
                  {e.estado === "na" && <span className="text-[10px] text-gray-600">não se aplica</span>}
                </div>
                {e.detalhe && e.estado !== "na" && <p className="text-xs text-gray-500 break-words">{e.detalhe}</p>}
                {(e.estado === "pendente" || e.estado === "manual") && e.acao && (e.acao !== "tutorial" || e.tutorial) && (
                  <button onClick={() => acionar(e)} className="mt-1 text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer">
                    {rotuloAcao[e.acao]}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
