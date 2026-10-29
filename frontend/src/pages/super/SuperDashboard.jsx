import { useState, useEffect, useRef, useMemo } from "react";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

const DIA_MS = 24 * 60 * 60 * 1000;

const STATUS_ASSINATURA = {
  trial: { rotulo: "Trial", classe: "bg-blue-900/30 text-blue-400" },
  ativa: { rotulo: "Ativa", classe: "bg-green-900/30 text-green-400" },
  vencida: { rotulo: "Vencida", classe: "bg-red-900/30 text-red-400" },
  cancelada: { rotulo: "Cancelada", classe: "bg-gray-700/40 text-gray-400" },
};

// Vencimento efetivo: trial vence em trial_ate; as demais em vence_em (sem data = sem vencimento).
function vencimentoDe(e) {
  const bruto = e.assinatura_status === "trial" ? e.trial_ate || e.vence_em : e.vence_em;
  if (!bruto) return null;
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasAte(data) {
  return Math.ceil((data.getTime() - Date.now()) / DIA_MS);
}

function textoPrazo(dias) {
  if (dias === 0) return "hoje";
  if (dias > 0) return `em ${dias} dia${dias === 1 ? "" : "s"}`;
  const atras = Math.abs(dias);
  return `há ${atras} dia${atras === 1 ? "" : "s"}`;
}

function moeda(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Valor mensal equivalente de uma assinatura ativa (plano de ciclo != 30 dias entra proporcional).
function valorMensal(e) {
  const valor = Number(e.assinatura_plano_valor || 0);
  const ciclo = Number(e.assinatura_ciclo_dias || 30);
  return ciclo > 0 ? (valor * 30) / ciclo : 0;
}

export default function SuperDashboard() {
  const raizRef = useRef(null);
  useTabelasMobile(raizRef);
  const { user, isSuperAdmin, donoPlataforma, logout, switchEmpresa } = useAuth();
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [erroAcesso, setErroAcesso] = useState("");
  const [alertas, setAlertas] = useState({}); // empresa_id -> [{tipo, nivel, mensagem}]
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate(`/admin/${user?.empresa_slug || 'default'}`);
      return;
    }
    fetchEmpresas();
  }, []);

  const fetchEmpresas = async () => {
    setLoading(true);
    setErro("");
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/empresas", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEmpresas(await res.json());
    } catch (err) {
      console.error("Erro ao buscar empresas:", err);
      setErro("Não foi possível carregar as empresas.");
    } finally {
      setLoading(false);
    }
    fetchAlertas();
  };

  // Separado da lista: a checagem do WhatsApp pode demorar e nao deve atrasar a tabela; falha so some com os alertas.
  const fetchAlertas = async () => {
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/empresas/alertas", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const mapa = {};
      for (const a of await res.json()) mapa[a.empresa_id] = a.alertas;
      setAlertas(mapa);
    } catch (err) {
      console.error("Erro ao buscar alertas:", err);
    }
  };

  const acessarEmpresa = async (e) => {
    setErroAcesso("");
    try {
      await switchEmpresa(e.id);
      window.location.href = `/admin/${e.slug}`;
    } catch (err) {
      setErroAcesso(`Não foi possível acessar "${e.nome}": ${err.message}`);
    }
  };

  const kpis = useMemo(() => {
    let ativas = 0, trial = 0, atencao = 0, mrr = 0, equipamentos = 0;
    for (const e of empresas) {
      if (e.ativo) ativas++;
      equipamentos += e.total_mikrotiks || 0;
      if (e.assinatura_status === "trial") trial++;
      if (e.assinatura_status === "ativa") mrr += valorMensal(e);
      const venc = vencimentoDe(e);
      if (e.assinatura_status === "vencida") atencao++;
      else if (venc && ["trial", "ativa"].includes(e.assinatura_status) && diasAte(venc) <= 7) atencao++;
    }
    return { ativas, trial, atencao, mrr, equipamentos };
  }, [empresas]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = empresas.filter((e) => {
      if (filtro === "alertas") {
        if (!alertas[e.id]) return false;
      } else if (filtro !== "todas" && (e.assinatura_status || "sem") !== filtro) return false;
      if (!termo) return true;
      return `${e.nome} ${e.slug}`.toLowerCase().includes(termo);
    });
    // Quem vence primeiro aparece primeiro; sem vencimento vai para o fim.
    return filtradas.sort((a, b) => {
      const va = vencimentoDe(a), vb = vencimentoDe(b);
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return va - vb;
    });
  }, [empresas, busca, filtro, alertas]);

  const cartao = (rotulo, valor, destaque) => (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5">
      <p className="text-gray-500 text-sm">{rotulo}</p>
      <p className={`text-3xl font-bold mt-1 ${destaque || "text-white"}`}>{valor}</p>
    </div>
  );

  return (
    <div ref={raizRef} className="super-pagina min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
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

        {/* Indicadores */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
          {cartao("Empresas ativas", `${kpis.ativas}/${empresas.length}`)}
          {cartao("Em trial", kpis.trial, "text-blue-400")}
          {cartao("Vencidas ou vencem em 7 dias", kpis.atencao, kpis.atencao ? "text-red-400" : "text-white")}
          {cartao("Receita mensal (ativas)", moeda(kpis.mrr), "text-green-400")}
          {cartao("Empresas com alertas", Object.keys(alertas).length, Object.keys(alertas).length ? "text-yellow-400" : "text-white")}
          {cartao("Equipamentos", kpis.equipamentos)}
        </div>

        {/* Acoes */}
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <Link to="/super/empresas" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm">
            Gerenciar Empresas
          </Link>
          {donoPlataforma && (
            <>
              <span className="text-gray-700 hidden sm:inline">|</span>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Plataforma</span>
              <Link to="/super/atualizar" className="px-3 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 text-sm">
                Atualizar Sistema
              </Link>
              <Link to="/super/backups" className="px-3 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 text-sm">
                Backups
              </Link>
              <Link to="/super/publicar-atualizacao" className="px-3 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-800 text-sm">
                Publicar Atualização
              </Link>
            </>
          )}
        </div>

        {/* Empresas */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-semibold text-white">Empresas</h2>
          <div className="flex flex-wrap gap-3">
            <input
              type="search"
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Buscar por nome ou slug"
              className="min-w-0 px-3 py-2 bg-[#1a1d27] border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600"
            />
            <select
              value={filtro}
              onChange={(ev) => setFiltro(ev.target.value)}
              className="px-3 py-2 bg-[#1a1d27] border border-gray-800 rounded-lg text-sm text-gray-200"
            >
              <option value="todas">Todas</option>
              <option value="alertas">Com alertas</option>
              <option value="trial">Trial</option>
              <option value="ativa">Ativas</option>
              <option value="vencida">Vencidas</option>
              <option value="cancelada">Canceladas</option>
              <option value="sem">Sem assinatura</option>
            </select>
          </div>
        </div>

        {erroAcesso && (
          <p className="mb-4 px-4 py-3 rounded-lg bg-red-900/20 text-red-400 text-sm">{erroAcesso}</p>
        )}

        {loading ? (
          <p className="text-gray-500">Carregando...</p>
        ) : erro ? (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 text-center">
            <p className="text-red-400 mb-3">{erro}</p>
            <button onClick={fetchEmpresas} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm">
              Tentar de novo
            </button>
          </div>
        ) : lista.length === 0 ? (
          <p className="text-gray-500">Nenhuma empresa encontrada.</p>
        ) : (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left p-4">Empresa</th>
                  <th className="text-left p-4">Slug</th>
                  <th className="text-left p-4">Plano</th>
                  <th className="text-center p-4">Assinatura</th>
                  <th className="text-left p-4">Vencimento</th>
                  <th className="text-center p-4">Equipamentos</th>
                  <th className="text-center p-4">Admins</th>
                  <th className="text-center p-4">Status</th>
                  <th className="text-center p-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => {
                  const st = STATUS_ASSINATURA[e.assinatura_status];
                  const venc = vencimentoDe(e);
                  const dias = venc ? diasAte(venc) : null;
                  const urgente = dias !== null && dias <= 7 && e.assinatura_status !== "cancelada";
                  return (
                    <tr key={e.id} className="border-b border-gray-800/50 hover:bg-[#252b3b]">
                      <td className="p-4 font-medium text-white">
                        {e.nome}
                        {(alertas[e.id] || []).map((a) => (
                          <span
                            key={a.tipo}
                            title={a.mensagem}
                            className={`block mt-1 text-xs font-normal ${a.nivel === "critico" ? "text-red-400" : "text-yellow-400"}`}
                          >
                            ⚠ {a.mensagem}
                          </span>
                        ))}
                      </td>
                      <td className="p-4 text-gray-400">{e.slug}</td>
                      <td className="p-4 text-gray-400">{e.assinatura_plano_nome || "—"}</td>
                      <td className="p-4 text-center">
                        {st ? (
                          <span className={`px-2 py-1 rounded text-xs ${st.classe}`}>{st.rotulo}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        {venc ? (
                          <>
                            {venc.toLocaleDateString("pt-BR")}{" "}
                            <span className={urgente ? "text-red-400" : "text-gray-500"}>
                              ({textoPrazo(dias)})
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="p-4 text-center">{e.total_mikrotiks || 0}</td>
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
                          onClick={() => acessarEmpresa(e)}
                          className="text-blue-400 hover:text-blue-300 text-sm"
                        >
                          Acessar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
