import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import useTabelasMobile from "../../hooks/useTabelasMobile";
import { useAuth } from "../../contexts/AuthContext";
import ToggleTema from "../../components/ToggleTema";
import CartaoMetrica from "../../components/super/CartaoMetrica";
import EnviarMensagemEmpresa from "../../components/super/EnviarMensagemEmpresa";
import { linkWhatsapp, aplicarVariaveis } from "../../utils/linkWhatsapp";

const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (v) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const dataHora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

const STATUS = {
  trial: { rotulo: "Trial", classe: "bg-blue-900/30 text-blue-400" },
  ativa: { rotulo: "Ativa", classe: "bg-green-900/30 text-green-400" },
  vencida: { rotulo: "Vencida", classe: "bg-red-900/30 text-red-400" },
  cancelada: { rotulo: "Cancelada", classe: "bg-gray-700/40 text-gray-400" },
};

const ACOES = {
  plano_alterado: "Plano alterado",
  gratificacao: "Gratificação",
  plano_gratis: "Plano gratuito",
  plano_pago: "Plano pago",
  status_assinatura: "Status da assinatura",
  suspensa: "Empresa suspensa",
  reativada: "Empresa reativada",
};

const ABAS = [
  ["resumo", "Resumo"],
  ["assinatura", "Assinatura"],
  ["cobrancas", "Cobranças"],
  ["uso", "Uso"],
  ["notas", "Notas e histórico"],
];

const entrada = "w-full min-w-0 px-3 py-2 bg-[#0f111a] border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600";
const botao = "px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed";

function Caixa({ titulo, descricao, children }) {
  return (
    <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5 min-w-0">
      <h3 className="text-white font-semibold">{titulo}</h3>
      {descricao && <p className="text-gray-500 text-sm mt-1 mb-3">{descricao}</p>}
      <div className={descricao ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

export default function EmpresaPainel() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { switchEmpresa } = useAuth();
  const raizRef = useRef(null);
  useTabelasMobile(raizRef);

  const [aba, setAba] = useState("resumo");
  const [dados, setDados] = useState(null);
  const [estado, setEstado] = useState("carregando"); // carregando | ok | erro
  const [erroCarga, setErroCarga] = useState("");
  const [msg, setMsg] = useState(null); // { tipo, texto }
  const [ocupado, setOcupado] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [notas, setNotas] = useState([]);
  const [semMigration, setSemMigration] = useState(false);

  // formularios
  const [planoNovo, setPlanoNovo] = useState("");
  const [motivoPlano, setMotivoPlano] = useState("");
  const [diasGrat, setDiasGrat] = useState("7");
  const [motivoGrat, setMotivoGrat] = useState("");
  const [planoGratis, setPlanoGratis] = useState("");
  const [motivoGratis, setMotivoGratis] = useState("");
  const [planoPago, setPlanoPago] = useState("");
  const [diasPago, setDiasPago] = useState("30");
  const [motivoPago, setMotivoPago] = useState("");
  const [statusNovo, setStatusNovo] = useState("ativa");
  const [motivoStatus, setMotivoStatus] = useState("");
  const [motivoSusp, setMotivoSusp] = useState("");
  const [confirmaSlug, setConfirmaSlug] = useState("");
  const [nota, setNota] = useState("");
  const [enviandoMsg, setEnviandoMsg] = useState(false);
  const [copiado, setCopiado] = useState("");

  const req = useCallback(async (caminho, opcoes = {}) => {
    const token = localStorage.getItem("admin_token");
    const res = await fetch(`/api/plataforma/empresas/${id}${caminho}`, {
      ...opcoes,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const corpo = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, corpo };
  }, [id]);

  const carregarExtras = useCallback(async () => {
    try {
      const [h, n] = await Promise.all([req("/historico"), req("/notas")]);
      if (h.status === 503 || n.status === 503) setSemMigration(true);
      else setSemMigration(false);
      setHistorico(h.ok && Array.isArray(h.corpo) ? h.corpo : []);
      setNotas(n.ok && Array.isArray(n.corpo) ? n.corpo : []);
    } catch (err) {
      console.error("Erro ao carregar notas/histórico:", err);
    }
  }, [req]);

  const carregar = useCallback(async () => {
    setEstado("carregando");
    try {
      const r = await req("");
      if (!r.ok) {
        setErroCarga(r.corpo.message || `Erro ${r.status}`);
        setEstado("erro");
        return;
      }
      setDados(r.corpo);
      setEstado("ok");
      carregarExtras();
    } catch (err) {
      console.error("Erro ao carregar empresa:", err);
      setErroCarga("Não foi possível carregar a empresa.");
      setEstado("erro");
    }
  }, [req, carregarExtras]);

  useEffect(() => { carregar(); }, [carregar]);

  // Executa uma acao (POST) e recarrega; confirmacao e mensagem inline.
  const agir = async (caminho, corpo, confirmar, aoSucesso) => {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const r = await req(caminho, { method: "POST", body: JSON.stringify(corpo) });
      if (r.ok) {
        setMsg({ tipo: "ok", texto: r.corpo.message || "Feito." });
        if (aoSucesso) aoSucesso();
        await carregar();
      } else {
        setMsg({ tipo: "erro", texto: r.corpo.message || "Não foi possível concluir." });
      }
    } catch (err) {
      console.error(err);
      setMsg({ tipo: "erro", texto: "Erro de conexão." });
    } finally {
      setOcupado(false);
    }
  };

  const acessar = async () => {
    try {
      await switchEmpresa(dados.empresa.id);
      window.location.href = `/admin/${dados.empresa.slug}`;
    } catch (err) {
      setMsg({ tipo: "erro", texto: `Não foi possível acessar: ${err.message}` });
    }
  };

  const copiar = async (texto, rotulo) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(rotulo);
      setTimeout(() => setCopiado(""), 2000);
    } catch {
      setMsg({ tipo: "erro", texto: "Não foi possível copiar." });
    }
  };

  const salvarNota = async (ev) => {
    ev.preventDefault();
    setOcupado(true);
    setMsg(null);
    const r = await req("/notas", { method: "POST", body: JSON.stringify({ texto: nota }) });
    setOcupado(false);
    if (r.ok) { setNota(""); carregarExtras(); } else setMsg({ tipo: "erro", texto: r.corpo.message || "Erro ao salvar a nota." });
  };

  const removerNota = async (notaId) => {
    if (!window.confirm("Remover esta nota?")) return;
    await req(`/notas/${notaId}`, { method: "DELETE" });
    carregarExtras();
  };

  if (estado === "carregando" && !dados) {
    return <div className="super-pagina painel min-h-screen bg-[#0f111a] text-gray-500 p-8">Carregando empresa...</div>;
  }
  if (estado === "erro" && !dados) {
    return (
      <div className="super-pagina painel min-h-screen bg-[#0f111a] text-gray-300 p-8">
        <p className="text-red-400 mb-4">{erroCarga}</p>
        <button onClick={carregar} className={`${botao} bg-blue-600 text-white mr-3`}>Tentar de novo</button>
        <button onClick={() => navigate("/super")} className={`${botao} bg-gray-700 text-gray-300`}>Voltar</button>
      </div>
    );
  }

  const { empresa, assinatura, adicionais, cobrancas, uso, alertas, planos, planos_gratis: planosGratisLista } = dados;
  const st = assinatura ? STATUS[assinatura.status] : null;
  const fim = assinatura && (assinatura.status === "trial" ? assinatura.trial_ate || assinatura.vence_em : assinatura.vence_em);
  const planosPagos = (planos || []).filter((p) => !p.gratis);

  const mensagem = msg && (
    <p className={`mb-4 px-4 py-3 rounded-lg text-sm ${msg.tipo === "ok" ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>{msg.texto}</p>
  );

  return (
    <div ref={raizRef} className="super-pagina painel min-h-screen bg-[#0f111a] text-gray-300 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Cabecalho */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <Link to="/super" className="text-sm text-gray-500 hover:text-gray-300">← Painel Super Admin</Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1 break-words">{empresa.nome}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
              <span className="text-gray-500">{empresa.slug}</span>
              {st && <span className={`px-2 py-1 rounded text-xs ${st.classe}`}>{st.rotulo}</span>}
              <span className={`px-2 py-1 rounded text-xs ${empresa.ativo ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                {empresa.ativo ? "Ativa" : "Suspensa"}
              </span>
              <span className="text-gray-400">Cliente há {dados.cliente_ha} (desde {data(empresa.criado_em)})</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleTema className="text-gray-400" />
            <button onClick={acessar} className={`${botao} bg-blue-600 text-white hover:bg-blue-500`}>Acessar painel</button>
            <Link to={`/super/empresas?editar=${empresa.id}`} className={`${botao} border border-gray-700 text-gray-300 hover:bg-gray-800`}>Editar cadastro</Link>
          </div>
        </div>

        {mensagem}

        {enviandoMsg && (
          <EnviarMensagemEmpresa
            empresa={empresa}
            req={req}
            onFechar={() => setEnviandoMsg(false)}
            onEnviada={(texto) => { setEnviandoMsg(false); setMsg({ tipo: "ok", texto }); carregarExtras(); }}
          />
        )}

        {/* Abas */}
        <div className="flex gap-1 overflow-x-auto border-b border-gray-800 mb-6" role="tablist">
          {ABAS.map(([chave, rotulo]) => (
            <button
              key={chave}
              role="tab"
              aria-selected={aba === chave}
              onClick={() => setAba(chave)}
              className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === chave ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {aba === "resumo" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <CartaoMetrica rotulo="Plano" valor={assinatura?.plano_nome || "—"} dica={assinatura?.gratis ? "Plano gratuito" : undefined} />
              <CartaoMetrica
                rotulo={assinatura?.gratis ? "Vencimento" : assinatura?.status === "trial" ? "Teste termina em" : "Vence em"}
                valor={assinatura?.gratis ? "Nunca" : data(fim)}
              />
              <CartaoMetrica rotulo="Cliente há" valor={dados.cliente_ha} />
              <CartaoMetrica rotulo="Valor do plano" valor={assinatura?.gratis ? "Grátis" : assinatura?.plano_valor != null ? moeda(assinatura.plano_valor) : "—"} />
            </div>
            <Caixa titulo="Cadastro">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="text-gray-500">{empresa.tipo_pessoa === "PF" ? "CPF" : "CNPJ"}</dt><dd className="text-gray-200">{empresa.cnpj || empresa.cpf || "—"}</dd></div>
                <div>
                  <dt className="text-gray-500">E-mail</dt>
                  <dd className="text-gray-200 break-words">{empresa.email || "—"}</dd>
                  {empresa.email && (
                    <button type="button" onClick={() => copiar(empresa.email, "email")} className="mt-2 px-3 py-1 rounded-lg text-xs border border-gray-700 text-gray-300 hover:bg-gray-800">
                      {copiado === "email" ? "Copiado!" : "Copiar"}
                    </button>
                  )}
                </div>
                <div>
                  <dt className="text-gray-500">Telefone</dt>
                  <dd className="text-gray-200">{empresa.telefone || "—"}</dd>
                  {empresa.telefone && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {linkWhatsapp(empresa.telefone) && (
                        <a
                          href={linkWhatsapp(empresa.telefone, aplicarVariaveis("Olá, {{nome}}! Aqui é da Apex Telecom.", { nome: String(empresa.nome || "").split(/\s+/)[0] }))}
                          target="_blank" rel="noopener noreferrer"
                          className="px-3 py-1 rounded-lg text-xs bg-green-600 text-white hover:bg-green-500"
                        >Abrir WhatsApp</a>
                      )}
                      {linkWhatsapp(empresa.telefone) && (
                        <button type="button" onClick={() => setEnviandoMsg(true)} className="px-3 py-1 rounded-lg text-xs border border-gray-700 text-gray-300 hover:bg-gray-800">Enviar mensagem</button>
                      )}
                      <button type="button" onClick={() => copiar(empresa.telefone, "telefone")} className="px-3 py-1 rounded-lg text-xs border border-gray-700 text-gray-300 hover:bg-gray-800">
                        {copiado === "telefone" ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                  )}
                </div>
                <div><dt className="text-gray-500">Cadastrada em</dt><dd className="text-gray-200">{dataHora(empresa.criado_em)}</dd></div>
                <div>
                  <dt className="text-gray-500">Boas-vindas no WhatsApp</dt>
                  <dd className="text-gray-200">{empresa.boas_vindas_em ? `Enviada em ${dataHora(empresa.boas_vindas_em)}` : "Ainda não enviada"}</dd>
                  {empresa.telefone && (
                    <button type="button" disabled={ocupado}
                      onClick={() => agir("/boas-vindas", {}, `Enviar a mensagem de boas-vindas agora para ${empresa.nome}?`)}
                      className="mt-2 px-3 py-1 rounded-lg text-xs border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                      {empresa.boas_vindas_em ? "Reenviar boas-vindas" : "Enviar boas-vindas"}
                    </button>
                  )}
                </div>
              </dl>
            </Caixa>
            <Caixa titulo="Alertas">
              {!alertas ? (
                <p className="text-gray-600 text-sm">Não foi possível checar os alertas agora.</p>
              ) : alertas.length === 0 ? (
                <p className="text-green-400 text-sm">Nenhum alerta. Tudo certo com esta empresa.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {alertas.map((a) => (
                    <li key={a.tipo} className={a.nivel === "critico" ? "text-red-400" : "text-yellow-400"}>⚠ {a.mensagem}</li>
                  ))}
                </ul>
              )}
            </Caixa>
          </div>
        )}

        {aba === "assinatura" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Caixa titulo="Situação atual">
              {assinatura ? (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Plano</dt><dd className="text-gray-200">{assinatura.plano_nome || "sem plano"}{assinatura.gratis ? " (gratuito)" : ""}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Status</dt><dd>{st && <span className={`px-2 py-1 rounded text-xs ${st.classe}`}>{st.rotulo}</span>}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-gray-500">Vencimento</dt><dd className="text-gray-200">{assinatura.gratis ? "nunca vence" : data(fim)}</dd></div>
                </dl>
              ) : (
                <p className="text-yellow-400 text-sm">Esta empresa ainda não tem assinatura. Ao escolher um plano abaixo ela é criada.</p>
              )}
            </Caixa>

            <Caixa titulo="Alterar plano" descricao="Troca o plano e mantém o vencimento atual. Para manter como está, não faça nada.">
              <div className="space-y-3">
                <select value={planoNovo} onChange={(e) => setPlanoNovo(e.target.value)} className={entrada}>
                  <option value="">Escolha o novo plano</option>
                  {(planos || []).map((p) => <option key={p.id} value={p.id}>{p.nome}{p.gratis ? " (gratuito)" : ` — ${moeda(p.valor)}`}</option>)}
                </select>
                <input value={motivoPlano} onChange={(e) => setMotivoPlano(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                <button
                  disabled={ocupado || !planoNovo}
                  onClick={() => agir("/plano", { plano_id: Number(planoNovo), motivo: motivoPlano }, "Alterar o plano desta empresa?", () => { setPlanoNovo(""); setMotivoPlano(""); })}
                  className={`${botao} bg-blue-600 text-white hover:bg-blue-500`}
                >
                  Alterar plano
                </button>
              </div>
            </Caixa>

            <Caixa titulo="Liberar gratificação" descricao="Soma dias de uso sem cobrar. Em teste, prolonga o teste; vencida, reabre o acesso.">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <input type="number" min="1" max="365" value={diasGrat} onChange={(e) => setDiasGrat(e.target.value)} className={`${entrada} max-w-[7rem]`} aria-label="Dias" />
                  <span className="self-center text-sm text-gray-500">dias</span>
                </div>
                <input value={motivoGrat} onChange={(e) => setMotivoGrat(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                <button
                  disabled={ocupado || assinatura?.gratis}
                  title={assinatura?.gratis ? "Plano gratuito nunca vence" : undefined}
                  onClick={() => agir("/gratificacao", { dias: Number(diasGrat), motivo: motivoGrat }, `Liberar ${diasGrat} dia(s) de gratificação?`, () => setMotivoGrat(""))}
                  className={`${botao} bg-green-600 text-white hover:bg-green-500`}
                >
                  Liberar gratificação
                </button>
              </div>
            </Caixa>

            <Caixa titulo="Deixar no plano grátis" descricao="Coloca a empresa num plano gratuito, sem vencimento.">
              {planosGratisLista && planosGratisLista.length > 0 ? (
                <div className="space-y-3">
                  <select value={planoGratis} onChange={(e) => setPlanoGratis(e.target.value)} className={entrada}>
                    <option value="">Escolha o plano gratuito</option>
                    {planosGratisLista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <input value={motivoGratis} onChange={(e) => setMotivoGratis(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                  <button
                    disabled={ocupado || !planoGratis}
                    onClick={() => agir("/plano-gratis", { plano_id: Number(planoGratis), motivo: motivoGratis }, "Colocar esta empresa no plano grátis?", () => { setPlanoGratis(""); setMotivoGratis(""); })}
                    className={`${botao} bg-purple-600 text-white hover:bg-purple-500`}
                  >
                    Deixar no plano grátis
                  </button>
                </div>
              ) : (
                <p className="text-yellow-400 text-sm">Nenhum plano gratuito cadastrado. Crie um em Planos SaaS (marque "plano grátis").</p>
              )}
            </Caixa>

            <Caixa titulo="Voltar para plano pago" descricao="Tira a empresa do plano gratuito e ativa um plano pago por alguns dias.">
              <div className="space-y-3">
                <select value={planoPago} onChange={(e) => setPlanoPago(e.target.value)} className={entrada}>
                  <option value="">Escolha o plano pago</option>
                  {planosPagos.map((p) => <option key={p.id} value={p.id}>{p.nome} — {moeda(p.valor)}</option>)}
                </select>
                <div className="flex gap-3">
                  <input type="number" min="1" max="365" value={diasPago} onChange={(e) => setDiasPago(e.target.value)} className={`${entrada} max-w-[7rem]`} aria-label="Dias" />
                  <span className="self-center text-sm text-gray-500">dias de uso</span>
                </div>
                <input value={motivoPago} onChange={(e) => setMotivoPago(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                <button
                  disabled={ocupado || !planoPago}
                  onClick={() => agir("/plano-pago", { plano_id: Number(planoPago), dias: Number(diasPago), motivo: motivoPago }, "Ativar o plano pago para esta empresa?", () => { setPlanoPago(""); setMotivoPago(""); })}
                  className={`${botao} bg-blue-600 text-white hover:bg-blue-500`}
                >
                  Ativar plano pago
                </button>
              </div>
            </Caixa>

            <Caixa titulo="Avançado: status da assinatura" descricao="Use só para corrigir um caso especial (cancelar, marcar como vencida).">
              <div className="space-y-3">
                <select value={statusNovo} onChange={(e) => setStatusNovo(e.target.value)} className={entrada}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
                </select>
                <input value={motivoStatus} onChange={(e) => setMotivoStatus(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                <button
                  disabled={ocupado}
                  onClick={() => agir("/status-assinatura", { status: statusNovo, motivo: motivoStatus }, `Mudar o status para "${STATUS[statusNovo].rotulo}"?`, () => setMotivoStatus(""))}
                  className={`${botao} border border-gray-700 text-gray-300 hover:bg-gray-800`}
                >
                  Alterar status
                </button>
              </div>
            </Caixa>

            <div className="lg:col-span-2">
              <Caixa titulo="Zona de risco" descricao="Suspender bloqueia o painel da empresa. O Wi-Fi dos clientes finais não é afetado.">
                <div className="space-y-3">
                  <input value={motivoSusp} onChange={(e) => setMotivoSusp(e.target.value)} placeholder="Motivo (obrigatório)" maxLength={200} className={entrada} />
                  {empresa.ativo ? (
                    <>
                      <input value={confirmaSlug} onChange={(e) => setConfirmaSlug(e.target.value)} placeholder={`Digite "${empresa.slug}" para confirmar`} className={entrada} />
                      <button
                        disabled={ocupado || confirmaSlug !== empresa.slug}
                        onClick={() => agir("/suspender", { motivo: motivoSusp }, null, () => { setMotivoSusp(""); setConfirmaSlug(""); })}
                        className={`${botao} bg-red-600 text-white hover:bg-red-500`}
                      >
                        Suspender empresa
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={ocupado}
                      onClick={() => agir("/reativar", { motivo: motivoSusp }, "Reativar esta empresa?", () => setMotivoSusp(""))}
                      className={`${botao} bg-green-600 text-white hover:bg-green-500`}
                    >
                      Reativar empresa
                    </button>
                  )}
                </div>
              </Caixa>
            </div>
          </div>
        )}

        {aba === "cobrancas" && (
          <div className="space-y-6">
            <Caixa titulo="Cobranças da assinatura">
              {!cobrancas ? (
                <p className="text-gray-600 text-sm">Não foi possível carregar as cobranças.</p>
              ) : cobrancas.length === 0 ? (
                <p className="text-gray-600 text-sm">Nenhuma cobrança registrada.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-800 text-gray-500">
                    <th className="text-left p-3">Data</th><th className="text-left p-3">Plano</th><th className="text-left p-3">Valor</th>
                    <th className="text-left p-3">Método</th><th className="text-left p-3">Status</th><th className="text-left p-3">Pago em</th>
                  </tr></thead>
                  <tbody>
                    {cobrancas.map((c) => (
                      <tr key={c.id} className="border-b border-gray-800/50">
                        <td className="p-3">{data(c.criado_em)}</td>
                        <td className="p-3">{c.plano_nome || "Adicional"}</td>
                        <td className="p-3">{moeda(c.valor)}</td>
                        <td className="p-3 uppercase">{c.metodo}</td>
                        <td className="p-3">{c.status}</td>
                        <td className="p-3">{dataHora(c.pago_em)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Caixa>
            <Caixa titulo="Adicionais">
              {!adicionais ? (
                <p className="text-gray-600 text-sm">Não foi possível carregar os adicionais.</p>
              ) : adicionais.length === 0 ? (
                <p className="text-gray-600 text-sm">Nenhum adicional contratado.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-800 text-gray-500">
                    <th className="text-left p-3">Adicional</th><th className="text-left p-3">Qtd.</th><th className="text-left p-3">Vence em</th><th className="text-left p-3">Situação</th>
                  </tr></thead>
                  <tbody>
                    {adicionais.map((a) => (
                      <tr key={a.id} className="border-b border-gray-800/50">
                        <td className="p-3">{a.nome}</td>
                        <td className="p-3">{a.quantidade}</td>
                        <td className="p-3">{data(a.vence_em)}</td>
                        <td className="p-3">{new Date(a.vence_em) > new Date() ? <span className="text-green-400">Vigente</span> : <span className="text-gray-500">Vencido</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Caixa>
          </div>
        )}

        {aba === "uso" && (
          uso ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <CartaoMetrica rotulo="Equipamentos" valor={uso.equipamentos} />
              <CartaoMetrica rotulo="Administradores" valor={uso.admins} />
              <CartaoMetrica rotulo="Clientes cadastrados" valor={uso.clientes_total.toLocaleString("pt-BR")} />
              <CartaoMetrica rotulo="Novos clientes (30 dias)" valor={uso.clientes_novos_30d.toLocaleString("pt-BR")} />
              <CartaoMetrica rotulo="Conexões (30 dias)" valor={uso.conexoes_30d.toLocaleString("pt-BR")} dica="Só gateways cadastrados pelo IP do equipamento" />
              <CartaoMetrica rotulo="Vendas do hotspot (30 dias)" valor={moeda(uso.vendas_30d.valor)} dica={`${uso.vendas_30d.n} venda(s) aprovada(s)`} />
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Não foi possível calcular o uso agora.</p>
          )
        )}

        {aba === "notas" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {semMigration && (
              <p className="lg:col-span-2 px-4 py-3 rounded-lg bg-yellow-900/20 text-yellow-400 text-sm">
                Notas e histórico indisponíveis: rode <code>node migrations/070_empresa_painel.js</code> no servidor.
              </p>
            )}
            <Caixa titulo="Notas internas" descricao="Só você, dono da plataforma, vê estas anotações.">
              <form onSubmit={salvarNota} className="space-y-3 mb-4">
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={1000} placeholder="Ex.: combinou pagar dia 10, pediu desconto..." className={entrada} />
                <button type="submit" disabled={ocupado || !nota.trim() || semMigration} className={`${botao} bg-blue-600 text-white hover:bg-blue-500`}>Salvar nota</button>
              </form>
              <ul className="space-y-3">
                {notas.map((n) => (
                  <li key={n.id} className="border border-gray-800 rounded-lg p-3 text-sm">
                    <p className="text-gray-200 whitespace-pre-wrap break-words">{n.texto}</p>
                    <p className="text-gray-600 text-xs mt-2 flex justify-between gap-3">
                      <span>{n.autor || "—"} · {dataHora(n.criado_em)}</span>
                      <button onClick={() => removerNota(n.id)} className="text-red-400 hover:text-red-300">Remover</button>
                    </p>
                  </li>
                ))}
                {notas.length === 0 && <li className="text-gray-600 text-sm">Nenhuma nota ainda.</li>}
              </ul>
            </Caixa>
            <Caixa titulo="Histórico de alterações" descricao="Quem mudou plano, liberou gratificação ou suspendeu a empresa.">
              <ul className="space-y-3">
                {historico.map((h) => (
                  <li key={h.id} className="border-l-2 border-gray-700 pl-3 text-sm">
                    <p className="text-gray-200">{ACOES[h.acao] || h.acao}</p>
                    {h.detalhes && <p className="text-gray-400 break-words">{h.detalhes}</p>}
                    <p className="text-gray-600 text-xs">{h.autor || "—"} · {dataHora(h.criado_em)}</p>
                  </li>
                ))}
                {historico.length === 0 && <li className="text-gray-600 text-sm">Nenhuma alteração registrada.</li>}
              </ul>
            </Caixa>
          </div>
        )}
      </div>
    </div>
  );
}
