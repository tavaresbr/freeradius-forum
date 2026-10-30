import React, { useCallback, useEffect, useState } from "react";
import AvisoExpiracao from "./AvisoExpiracao";
import PosCompra from "./PosCompra";
import Renovacao from "./Renovacao";

const DIAS = (d) => (d === 0 ? "no dia do vencimento" : `${d} dia${d > 1 ? "s" : ""} depois`);

// Régua de cobrança (compras do portal): linha do tempo com as 3 mensagens automáticas. Cada etapa abre a sua configuração.
export default function Regua({ headers }) {
  const [dados, setDados] = useState({});
  const [rel, setRel] = useState(null);
  const [modal, setModal] = useState(null);

  const carregar = useCallback(async () => {
    const pegar = async (url) => { try { const r = await fetch(url, { headers }); return r.ok ? await r.json() : null; } catch { return null; } };
    const [aviso, pos, ren, relatorio] = await Promise.all([
      pegar("/api/atendimento/aviso-expiracao"), pegar("/api/atendimento/pos-compra"), pegar("/api/atendimento/renovacao"), pegar("/api/atendimento/renovacao/relatorio?dias=30"),
    ]);
    setDados({ aviso: aviso?.aviso, pos: pos?.pos_compra, ren: ren?.renovacao });
    setRel(relatorio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const fechar = () => { setModal(null); carregar(); };

  const etapas = [
    { id: "pos", momento: "Compra aprovada", titulo: "Agradecimento pós-compra", detalhe: dados.pos ? `${dados.pos.horas_apos} h depois da compra` : "", ativo: dados.pos?.ativo,
      texto: "Agradece e, se a pessoa avaliar o atendimento com nota alta, pede a avaliação; nota baixa avisa a equipe." },
    { id: "aviso", momento: "Acesso acabando", titulo: "Aviso de expiração", detalhe: dados.aviso ? `${dados.aviso.minutos} min antes do fim` : "", ativo: dados.aviso?.ativo,
      texto: "Para quem está conectado e o tempo está acabando: manda o link para comprar mais tempo." },
    { id: "ren", momento: "Acesso vencido", titulo: "Renovação", detalhe: dados.ren?.dias?.length ? dados.ren.dias.map(DIAS).join(" · ") : "", ativo: dados.ren?.ativo,
      texto: "Lembra quem comprou no portal e o acesso venceu, com link dos planos (e cupom, se configurado)." },
  ];

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-gray-400">A régua cobre as <b>compras do portal</b>: as mensagens saem sozinhas, só para quem tem telefone no cadastro, nunca para quem pediu para não receber mensagens e com limite por rodada. Tudo começa desligado.</p>
      <ol className="space-y-3">
        {etapas.map((e, i) => (
          <li key={e.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`w-3 h-3 rounded-full mt-1.5 ${e.ativo ? "bg-green-500" : "bg-gray-600"}`} aria-hidden="true" />
              {i < etapas.length - 1 && <span className="flex-1 w-px bg-gray-700 mt-1" aria-hidden="true" />}
            </div>
            <div className="flex-1 min-w-0 bg-[#1a1d27] border border-gray-800 rounded-xl p-3">
              <p className="text-xs text-gray-500">{e.momento}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-100">{e.titulo}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${e.ativo ? "bg-green-900/40 text-green-300" : "bg-gray-800 text-gray-400"}`}>{e.ativo ? "Ligada" : "Desligada"}</span>
                {e.detalhe && <span className="text-xs text-gray-400">{e.detalhe}</span>}
                <button onClick={() => setModal(e.id)} className="ml-auto text-sm text-blue-400 hover:text-blue-300 cursor-pointer">Configurar</button>
              </div>
              <p className="text-sm text-gray-400 mt-1">{e.texto}</p>
            </div>
          </li>
        ))}
      </ol>
      {rel && (
        <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-3 text-sm text-gray-300">
          Renovação, últimos 30 dias: <b>{rel.enviadas}</b> lembretes enviados, <b>{rel.convertidas}</b> voltaram a comprar em até 7 dias ({rel.taxa}%).
        </div>
      )}
      {modal === "pos" && <PosCompra headers={headers} onFechar={fechar} />}
      {modal === "aviso" && <AvisoExpiracao headers={headers} onFechar={fechar} />}
      {modal === "ren" && <Renovacao headers={headers} onFechar={fechar} />}
    </div>
  );
}
