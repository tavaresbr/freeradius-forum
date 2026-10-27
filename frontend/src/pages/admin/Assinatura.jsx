import React, { useState, useEffect, useCallback, useRef } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAuth } from "../../contexts/AuthContext";
import { avisoUpgrade } from "../../utils/upgradeAviso";

const ROTULO = { trial: "Período de teste", ativa: "Ativa", vencida: "Vencida", cancelada: "Cancelada", sem_assinatura: "Sem assinatura" };
const COR = {
  trial: "bg-blue-900/30 text-blue-300", ativa: "bg-green-900/30 text-green-400",
  vencida: "bg-red-900/30 text-red-400", cancelada: "bg-red-900/30 text-red-400", sem_assinatura: "bg-red-900/30 text-red-400",
};
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const limite = (v) => (v == null ? "ilimitado" : v);

export default function Assinatura() {
  const { isSuperAdmin, user } = useAuth();
  const podePagar = isSuperAdmin || user?.role === "owner"; // mesma regra do backend (authorize owner/super_admin)
  const [st, setSt] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [adic, setAdic] = useState({ catalogo: [], minhas: [] });
  const [qtds, setQtds] = useState({}); // quantidade escolhida por adicional
  const [cobranca, setCobranca] = useState(null);
  const [gerando, setGerando] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [escolhido, setEscolhido] = useState(null); // plano selecionado para pagar
  const [metodo, setMetodo] = useState("pix");
  const [fp, setFp] = useState("loading"); // fingerprint MP: loading | ready | error
  const [cartao, setCartao] = useState({ numero: "", nome: "", validade: "", cvv: "", cpf: "" });
  const [pagandoCartao, setPagandoCartao] = useState(false);
  const timer = useRef(null);

  const token = localStorage.getItem("admin_token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      fetch("/api/assinatura/status", { headers }),
      fetch("/api/assinatura/planos"),
      fetch("/api/assinatura/adicionais", { headers }),
    ]);
    if (a.ok) setSt(await a.json());
    if (b.ok) setPlanos(await b.json());
    if (c.ok) setAdic(await c.json());
  }, []);

  useEffect(() => { carregar().catch(() => {}); return () => clearInterval(timer.current); }, [carregar]);

  // Antifraude do MP: sem window.MP_DEVICE_SESSION_ID o cartao cai em cc_rejected_high_risk.
  useEffect(() => {
    if (!escolhido || metodo !== "cartao") return;
    if (window.MP_DEVICE_SESSION_ID) { setFp("ready"); return; }
    setFp("loading");
    if (!document.getElementById("mp-security-js")) {
      const sc = document.createElement("script");
      sc.id = "mp-security-js"; sc.src = "/mp-security.js"; sc.async = true;
      sc.setAttribute("view", "checkout");
      sc.onerror = () => setFp("error");
      document.body.appendChild(sc);
    }
    const ini = Date.now();
    const iv = setInterval(() => {
      if (window.MP_DEVICE_SESSION_ID) { setFp("ready"); clearInterval(iv); }
      else if (Date.now() - ini > 15000) { setFp("error"); clearInterval(iv); }
    }, 300);
    return () => clearInterval(iv);
  }, [escolhido, metodo]);

  const aguardarConfirmacao = (id) => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/assinatura/cobranca/${id}`, { headers });
      if (!r.ok) return;
      const d = await r.json();
      if (d.status === "aprovada") {
        clearInterval(timer.current);
        setCobranca((c) => ({ ...(c || {}), pago: true, plano: c?.plano || escolhido?.rotulo }));
        setEscolhido(null);
        carregar();
      } else if (d.status === "recusada") {
        clearInterval(timer.current);
        setCobranca(null);
        setErro("Pagamento recusado. Tente novamente.");
      }
    }, 4000);
  };

  const pagarCartao = async (e) => {
    e.preventDefault();
    setErro("");
    const [mm, aa] = cartao.validade.split("/");
    if (!mm || !aa) return setErro("Informe a validade no formato MM/AA.");
    setPagandoCartao(true);
    try {
      const res = await fetch("/api/assinatura/cartao", {
        method: "POST", headers,
        body: JSON.stringify({
          ...escolhido.payload, card_number: cartao.numero, cardholder_name: cartao.nome,
          expiration_month: mm, expiration_year: aa, security_code: cartao.cvv,
          identification_number: cartao.cpf, device_session_id: window.MP_DEVICE_SESSION_ID,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || "Pagamento recusado.");
      setCartao({ numero: "", nome: "", validade: "", cvv: "", cpf: "" });
      if (d.status === "approved") {
        setCobranca({ pago: true, plano: escolhido.rotulo });
        setEscolhido(null);
        carregar();
      } else {
        setCobranca({ aguardandoCartao: true, plano: escolhido.rotulo });
        setEscolhido(null);
        aguardarConfirmacao(d.id);
      }
    } catch (err) {
      setErro(err.message);
    } finally {
      setPagandoCartao(false);
    }
  };

  // Itens a pagar: plano ou adicional. `payload` e' o que o servidor recebe (o valor e' recalculado la).
  const itemPlano = (p) => ({ chave: `p${p.id}`, nome: p.nome, rotulo: `Assinatura ${p.nome}`, valor: Number(p.valor), payload: { plano_id: p.id } });
  const itemAdicional = (a, qtd) => ({
    chave: `a${a.id}`, nome: a.nome, rotulo: `Adicional ${a.nome}${qtd > 1 ? ` x${qtd}` : ""}`,
    valor: Math.round(a.valor * qtd * 100) / 100, payload: { adicional_id: a.id, quantidade: qtd }, extra: Math.round(a.valor * qtd * 100) / 100,
  });
  const itemRenovacao = (m) => ({
    chave: `r${m.id}`, nome: m.nome, rotulo: `Renovação ${m.nome}${m.quantidade > 1 ? ` x${m.quantidade}` : ""}`,
    valor: Math.round(m.valor * m.quantidade * 100) / 100, payload: { renovar_adicional_id: m.id },
  });
  const escolher = (item) => { setEscolhido(item); setMetodo("pix"); setErro(""); };

  const pagar = async (plano) => {
    setErro(""); setGerando(plano.chave);
    try {
      const res = await fetch("/api/assinatura/cobranca", { method: "POST", headers, body: JSON.stringify(plano.payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Erro ao gerar cobrança");
      setCobranca({ ...data, plano: plano.rotulo });
      aguardarConfirmacao(data.id);
    } catch (e) {
      setErro(e.message);
    } finally {
      setGerando(null);
    }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(cobranca.copia_cola); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* ignora */ }
  };

  const vigentes = adic.minhas.filter((m) => m.vigente);
  const adicionaisValor = vigentes.reduce((t, m) => t + m.valor * m.quantidade, 0);
  const aviso = (extra = 0) => avisoUpgrade({ planos, planoAtualId: st?.plano_id, adicionaisValor, extra });
  const textoAviso = (a) => (a.tipo === "economiza"
    ? `O plano ${a.plano.nome} (${brl(a.plano.valor)}) custa ${brl(a.diferenca)} a menos que a sua soma atual e inclui mais. Vale fazer upgrade.`
    : `Por ${brl(a.diferenca)} a mais você leva o plano ${a.plano.nome} completo.`);
  const caixaAviso = (a) => a && (
    <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3" data-testid="aviso-upgrade">💡 {textoAviso(a)}</p>
  );
  const fim = st?.fim ? new Date(st.fim).toLocaleDateString("pt-BR") : "—";

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-white">Assinatura</h1>
          <p className="text-sm text-gray-400 mt-1">Plano de uso do sistema desta empresa.</p>
        </div>

        {!podePagar && <p className="text-sm text-yellow-400 bg-yellow-900/20 p-3 rounded-lg">Somente o proprietário (owner) da conta pode pagar ou renovar a assinatura. Peça a ele ou ao suporte.</p>}
        {isSuperAdmin && <p className="text-sm text-yellow-400 bg-yellow-900/20 p-3 rounded-lg">Super admin: o status abaixo é só informativo; você nunca é bloqueado.</p>}

        {st?.bloqueada && (
          <div className="bg-red-900/20 border border-red-700/40 text-red-200 rounded-xl p-4 text-sm">
            Sua assinatura está vencida e o painel foi bloqueado. Escolha um plano abaixo e pague por PIX ou cartão para liberar o acesso na hora.
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
              <p className="text-white mt-1">{st.uso?.equipamentos ?? 0}/{limite(st.max_equipamentos)} equipamentos{st.extras?.equipamentos > 0 && <span className="text-xs text-gray-400"> ({limite(st.plano_max_equipamentos)} do plano + {st.extras.equipamentos})</span>}</p>
              {st.max_portais !== undefined && <p className="text-white">{st.uso?.portais ?? 0}/{limite(st.max_portais)} portais{st.extras?.portais > 0 && <span className="text-xs text-gray-400"> ({limite(st.plano_max_portais)} do plano + {st.extras.portais})</span>}</p>}
              <p className="text-white">{st.uso?.admins ?? 0}/{limite(st.max_admins)} administradores{st.extras?.admins > 0 && <span className="text-xs text-gray-400"> ({limite(st.plano_max_admins)} do plano + {st.extras.admins})</span>}</p>
            </div>
          </div>
        )}

        {erro && <p className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg" role="alert">{erro}</p>}

        {escolhido && !cobranca ? (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 max-w-lg">
            <h2 className="text-lg font-bold text-white">{escolhido.rotulo} – {brl(escolhido.valor)}</h2>
            {escolhido.extra > 0 && <div className="mt-3">{caixaAviso(aviso(escolhido.extra))}</div>}
            <div className="flex gap-2 mt-4">
              {[["pix", "PIX"], ["cartao", "Cartão de crédito"]].map(([k, r]) => (
                <button key={k} onClick={() => { setMetodo(k); setErro(""); }} className={`px-4 py-2 rounded-lg text-sm ${metodo === k ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}>{r}</button>
              ))}
            </div>
            {metodo === "pix" ? (
              <button disabled={gerando === escolhido.chave} onClick={() => pagar(escolhido)} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium">
                {gerando === escolhido.chave ? "Gerando PIX..." : "Gerar QR Code PIX"}
              </button>
            ) : fp === "loading" ? (
              <p className="mt-4 text-sm text-gray-400">Preparando ambiente seguro...</p>
            ) : fp === "error" ? (
              <p className="mt-4 text-sm text-red-400">Não foi possível carregar a verificação de segurança. Recarregue a página ou use PIX.</p>
            ) : (
              <form onSubmit={pagarCartao} className="mt-4 space-y-3" autoComplete="off">
                <input required inputMode="numeric" placeholder="Número do cartão" maxLength={23} value={cartao.numero} onChange={(e) => setCartao({ ...cartao, numero: e.target.value })} className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                <input required placeholder="Nome impresso no cartão" value={cartao.nome} onChange={(e) => setCartao({ ...cartao, nome: e.target.value })} className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <input required placeholder="Validade MM/AA" maxLength={5} value={cartao.validade} onChange={(e) => { let v = e.target.value.replace(/[^\d/]/g, ""); if (v.length === 2 && !v.includes("/") && e.nativeEvent.inputType !== "deleteContentBackward") v += "/"; setCartao({ ...cartao, validade: v }); }} className="bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                  <input required inputMode="numeric" placeholder="CVV" maxLength={4} value={cartao.cvv} onChange={(e) => setCartao({ ...cartao, cvv: e.target.value })} className="bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <input required inputMode="numeric" placeholder="CPF do titular" maxLength={14} value={cartao.cpf} onChange={(e) => setCartao({ ...cartao, cpf: e.target.value })} className="w-full bg-[#0d1117] border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
                <button disabled={pagandoCartao} className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium">{pagandoCartao ? "Processando..." : `Pagar ${brl(escolhido.valor)}`}</button>
              </form>
            )}
            <button onClick={() => { setEscolhido(null); setErro(""); }} className="mt-3 text-sm text-gray-400 underline">Voltar</button>
          </div>
        ) : cobranca ? (
          <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-6 text-center">
            {cobranca.aguardandoCartao ? (
              <p className="text-gray-300">Pagamento de {cobranca.plano} em análise... a tela atualiza sozinha.</p>
            ) : cobranca.pago ? (
              <>
                <p className="text-2xl text-green-400 font-bold">Pagamento confirmado!</p>
                <p className="text-gray-400 mt-2">{cobranca.plano} ativado.</p>
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
                  {p.max_portais !== undefined && <li>✓ {limite(p.max_portais)} portais</li>}
                  {[["inclui_whatsapp", "WhatsApp"], ["inclui_campanhas", "Campanhas"], ["inclui_exportacao", "Exportação da base"]].map(([k, r]) => (
                    p[k] !== undefined && <li key={k} className={p[k] ? "" : "opacity-50"}>{p[k] ? "✓" : "—"} {r}</li>
                  ))}
                </ul>
                <button disabled={!podePagar} onClick={() => escolher(itemPlano(p))} className="mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium">
                  {p.id === st?.plano_id && st?.status === "ativa" ? "Renovar" : "Assinar"}
                </button>
              </div>
            ))}
          </div>
        )}

        {!escolhido && !cobranca && (adic.catalogo.length > 0 || adic.minhas.length > 0) && (
          <section className="space-y-4" data-testid="secao-adicionais">
            <div>
              <h2 className="text-xl font-bold text-white">Adicionais</h2>
              <p className="text-sm text-gray-400 mt-1">Fique no seu plano e compre só o que precisa. Cada adicional vale 30 dias e pode ser renovado.</p>
            </div>
            {caixaAviso(aviso())}

            {adic.minhas.length > 0 && (
              <div className="bg-[#1a1d27] border border-gray-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-3">Seus adicionais</h3>
                <ul className="divide-y divide-gray-800">
                  {adic.minhas.map((m) => (
                    <li key={m.id} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-white flex-1 min-w-[10rem]">{m.nome}{m.quantidade > 1 && ` x${m.quantidade}`}</span>
                      <span className={m.vigente ? "text-green-400" : "text-red-400"}>
                        {m.vigente ? `vence em ${new Date(m.vence_em).toLocaleDateString("pt-BR")}` : `venceu em ${new Date(m.vence_em).toLocaleDateString("pt-BR")}`}
                      </span>
                      <button disabled={!podePagar} onClick={() => escolher(itemRenovacao(m))} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-xs">Renovar</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {adic.catalogo.map((a) => {
                const qtd = Math.min(20, Math.max(1, qtds[a.id] || 1));
                const item = itemAdicional(a, qtd);
                return (
                  <div key={a.id} className={`bg-[#1a1d27] border border-gray-800 rounded-xl p-5 flex flex-col ${a.disponivel ? "" : "opacity-60"}`}>
                    <h3 className="text-lg font-bold text-white">{a.nome}</h3>
                    <p className="text-sm text-gray-500">{a.descricao}</p>
                    <p className="mt-3 text-2xl font-extrabold text-white">{brl(a.valor)}<span className="text-sm text-gray-500 font-normal"> / {a.ciclo_dias} dias</span></p>
                    {a.plano_minimo_nome && <p className="text-xs text-gray-500 mt-1">A partir do plano {a.plano_minimo_nome}</p>}
                    {a.disponivel ? (
                      <>
                        <label className="mt-3 text-xs text-gray-400 flex items-center gap-2">Quantidade
                          <input type="number" min="1" max="20" value={qtd} onChange={(e) => setQtds({ ...qtds, [a.id]: parseInt(e.target.value, 10) || 1 })} className="w-16 bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm" />
                        </label>
                        {qtd > 1 && <p className="text-xs text-gray-400 mt-1">Total: {brl(item.valor)}</p>}
                        {(() => { const av = aviso(item.extra); return av ? <p className="text-xs text-yellow-300 mt-2">💡 {textoAviso(av)}</p> : null; })()}
                        <button disabled={!podePagar} onClick={() => escolher(item)} className="mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium">Comprar</button>
                      </>
                    ) : (
                      <p className="mt-3 text-xs text-gray-400 flex-1">{a.motivo}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
