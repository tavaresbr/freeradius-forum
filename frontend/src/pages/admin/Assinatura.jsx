import React, { useState, useEffect, useCallback, useRef } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";

const ROTULO = { trial: "Período de teste", ativa: "Ativa", vencida: "Vencida", cancelada: "Cancelada", sem_assinatura: "Sem assinatura" };
const COR = {
  trial: "bg-blue-900/30 text-blue-300", ativa: "bg-green-900/30 text-green-400",
  vencida: "bg-red-900/30 text-red-400", cancelada: "bg-red-900/30 text-red-400", sem_assinatura: "bg-red-900/30 text-red-400",
};
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const limite = (v) => (v == null ? "ilimitado" : v);

export default function Assinatura() {
  const { isSuperAdmin } = useAuth();
  const [st, setSt] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [cobranca, setCobranca] = useState(null);
  const [gerando, setGerando] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const timer = useRef(null);

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch("/api/assinatura/status", { headers }),
      fetch("/api/assinatura/planos"),
    ]);
    if (a.ok) setSt(await a.json());
    if (b.ok) setPlanos(await b.json());
  }, []);

  useEffect(() => { carregar().catch(() => {}); return () => clearInterval(timer.current); }, [carregar]);

  const pagar = async (plano) => {
    setErro(""); setGerando(plano.id);
    try {
      const res = await fetch("/api/assinatura/cobranca", { method: "POST", headers, body: JSON.stringify({ plano_id: plano.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao gerar cobrança");
      setCobranca({ ...data, plano: plano.nome });
      clearInterval(timer.current);
      timer.current = setInterval(async () => {
        const r = await fetch(`/api/assinatura/cobranca/${data.id}`, { headers });
        if (!r.ok) return;
        const d = await r.json();
        if (d.status === "aprovada") {
          clearInterval(timer.current);
          setCobranca((c) => ({ ...c, pago: true }));
          carregar();
        } else if (d.status === "recusada") {
          clearInterval(timer.current);
          setCobranca(null);
          setErro("Pagamento recusado. Tente novamente.");
        }
      }, 4000);
    } catch (e) {
      setErro(e.message);
    } finally {
      setGerando(null);
    }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(cobranca.copia_cola); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* ignora */ }
  };

  const fim = st?.fim ? new Date(st.fim).toLocaleDateString("pt-BR") : "—";

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Assinatura</h1>
          <p className="text-sm text-gray-400 mt-1">Plano de uso do sistema desta empresa.</p>
        </div>

        {isSuperAdmin && <p className="text-sm text-yellow-400 bg-yellow-900/20 p-3 rounded-lg">Super admin: o status abaixo é só informativo; você nunca é bloqueado.</p>}

        {st?.bloqueada && (
          <div className="bg-red-900/20 border border-red-700/40 text-red-200 rounded-xl p-4 text-sm">
            Sua assinatura está vencida e o painel foi bloqueado. Escolha um plano abaixo e pague via PIX para liberar o acesso na hora.
            Os clientes do seu Wi-Fi continuam conectando normalmente.
          </div>
        )}

        {st && (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 grid gap-4 sm:grid-cols-4 text-sm">
            <div><p className="text-gray-500">Status</p><span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${COR[st.status] || COR.vencida}`}>{ROTULO[st.status] || st.status}</span></div>
            <div><p className="text-gray-500">Plano</p><p className="text-white mt-1">{st.plano_nome || "—"}</p></div>
            <div><p className="text-gray-500">{st.status === "trial" ? "Teste até" : "Vencimento"}</p><p className="text-white mt-1">{fim}</p></div>
            <div>
              <p className="text-gray-500">Uso</p>
              <p className="text-white mt-1">{st.uso?.equipamentos ?? 0}/{limite(st.max_equipamentos)} equipamentos</p>
              <p className="text-white">{st.uso?.admins ?? 0}/{limite(st.max_admins)} administradores</p>
            </div>
          </div>
        )}

        {erro && <p className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg" role="alert">{erro}</p>}

        {cobranca ? (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 text-center">
            {cobranca.pago ? (
              <>
                <p className="text-2xl text-green-400 font-bold">Pagamento confirmado!</p>
                <p className="text-gray-400 mt-2">Assinatura {cobranca.plano} ativada.</p>
                <button onClick={() => setCobranca(null)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Voltar</button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-white">PIX – {cobranca.plano} ({brl(cobranca.valor)})</h2>
                <img alt="QR Code PIX" className="mx-auto mt-4 w-52 h-52 bg-white p-2 rounded-lg" src={`data:image/png;base64,${cobranca.qr_code_base64}`} />
                <textarea readOnly value={cobranca.copia_cola} rows={3} className="mt-4 w-full bg-[#0d1117] border border-gray-700 text-gray-300 rounded-lg p-2 text-xs" />
                <div className="mt-3 flex gap-3 justify-center">
                  <button onClick={copiar} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">{copiado ? "Copiado!" : "Copiar código"}</button>
                  <button onClick={() => { clearInterval(timer.current); setCobranca(null); }} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm">Cancelar</button>
                </div>
                <p className="text-xs text-gray-500 mt-3">Aguardando pagamento... a tela atualiza sozinha.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {planos.map((p) => (
              <div key={p.id} className={`bg-[#1a1d27] border rounded-xl p-5 flex flex-col ${p.id === st?.plano_id ? "border-blue-500" : "border-gray-800"}`}>
                <h3 className="text-lg font-bold text-white">{p.nome}</h3>
                <p className="text-sm text-gray-500">{p.descricao}</p>
                <p className="mt-3 text-3xl font-extrabold text-white">{brl(p.valor)}<span className="text-sm text-gray-500 font-normal"> / {p.ciclo_dias} dias</span></p>
                <ul className="mt-3 text-sm text-gray-300 space-y-1 flex-1">
                  <li>✓ {limite(p.max_equipamentos)} equipamentos</li>
                  <li>✓ {limite(p.max_admins)} administradores</li>
                </ul>
                <button disabled={gerando === p.id} onClick={() => pagar(p)} className="mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium">
                  {gerando === p.id ? "Gerando PIX..." : p.id === st?.plano_id && st?.status === "ativa" ? "Renovar com PIX" : "Pagar com PIX"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
