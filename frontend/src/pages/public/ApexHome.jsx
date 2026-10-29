import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import SiteHeader from "../../components/public/SiteHeader";
import LinkPainel from "../../components/public/LinkPainel";
import useBranding from "../../hooks/useBranding";
import useSeo from "../../hooks/useSeo";
import { Wifi, Zap, ShieldCheck, BarChart3, Check, MessageCircle, Layout, Router, Users, Image as Imagem } from "lucide-react";

import { SITE_URL, TITULO, DESCRICAO, WHATSAPP, TELEFONE, EMAIL, COMO_FUNCIONA, RECURSOS as RECURSOS_TEXTO, FAQ } from "../../constants/siteSeo";

// Fallback caso a API de planos esteja indisponivel (a fonte real e' /api/assinatura/planos).
const PLANOS_FALLBACK = [
  { id: null, nome: "Básico", descricao: "Para começar", valor: 49.9, ciclo_dias: 30, max_equipamentos: 1, max_admins: 2 },
  { id: null, nome: "Pro", descricao: "Para provedores em crescimento", valor: 99.9, ciclo_dias: 30, max_equipamentos: 5, max_admins: 5 },
  { id: null, nome: "Business", descricao: "Sem limites", valor: 199.9, ciclo_dias: 30, max_equipamentos: null, max_admins: null },
];
const VANTAGENS = [
  { icone: Wifi, titulo: "Hotspot completo", texto: "Captive portal com login, planos pagos, cadastro e LGPD." },
  { icone: Zap, titulo: "PIX e cartão", texto: "Venda acesso Wi-Fi e receba na hora, sem trabalho manual." },
  { icone: ShieldCheck, titulo: "Marco Civil e LGPD", texto: "Logs de conexão e consentimento prontos para auditoria." },
  { icone: BarChart3, titulo: "Multi-equipamento", texto: "MikroTik, Omada, UniFi e Grandstream em um só painel." },
];
// Textos (RECURSOS, FAQ, COMO_FUNCIONA) vem de constants/siteSeo.js: o mesmo conteudo vai para o HTML estatico e o JSON-LD.
const ICONES = { portais: Layout, pagamentos: Zap, whatsapp: MessageCircle, conformidade: ShieldCheck, equipamentos: Router, clientes: Users, campanhas: Imagem, equipe: BarChart3 };
const RECURSOS = RECURSOS_TEXTO.map((r) => ({ ...r, icone: ICONES[r.chave] || Layout }));

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const limite = (v) => (v == null ? "Ilimitados" : v);
// "2 equipamentos", "1 administrador", "Equipamentos ilimitados"
const rotuloLimite = (v, um, varios) => (v == null ? `${varios[0].toUpperCase()}${varios.slice(1)} ilimitados` : `${v} ${Number(v) === 1 ? um : varios}`);

export default function ApexHome() {
  const { nome } = useBranding();
  useSeo({ titulo: TITULO, descricao: DESCRICAO, caminho: "/" });
  const [planos, setPlanos] = useState(PLANOS_FALLBACK);
  const { hash } = useLocation();

  // Vindo de /login ou /registro com /#planos: o React Router nao rola sozinho ate a ancora
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 50);
    return () => clearTimeout(t);
  }, [hash]);

  useEffect(() => {
    fetch("/api/assinatura/planos")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d) && d.length) setPlanos(d); })
      .catch(() => {});
  }, []);

  // Precos reais (da API) para os buscadores: so quando vierem do servidor, nunca do fallback.
  useEffect(() => {
    const reais = planos.filter((p) => p.id != null);
    const id = "ld-planos";
    document.getElementById(id)?.remove();
    if (!reais.length) return;
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    el.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: `${nome} - Sistema de Wi-Fi Hotspot`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: reais.map((p) => ({
        "@type": "Offer",
        name: p.nome,
        description: p.descricao || undefined,
        price: Number(p.valor).toFixed(2),
        priceCurrency: "BRL",
        url: `${SITE_URL}/registro?plano=${p.id}`,
        availability: "https://schema.org/InStock",
      })),
    }).replace(/</g, "\\u003c");
    document.head.appendChild(el);
    return () => el.remove();
  }, [planos, nome]);

  const cadastro = (p) => (p?.id ? `/registro?plano=${p.id}` : "/registro");

  return (
    <div className="tema-site min-h-screen bg-white text-gray-800">
      <SiteHeader />

      <section id="topo" className="pt-32 pb-20 lg:pt-40 lg:pb-28 px-4 bg-gradient-to-br from-apex-50 via-white to-apex-100 text-apex-900">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div className="text-center md:text-left">
            <span className="inline-block text-xs font-semibold bg-apex-100 text-apex-700 px-3 py-1 rounded-full">7 dias grátis, sem cartão</span>
            <h1 className="mt-4 text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight text-balance md:text-wrap">
              Wi&#8209;Fi Hotspot que <span className="text-apex-500">vende e cadastra</span> por você
            </h1>
            <p className="mt-5 text-lg text-gray-600 max-w-xl mx-auto md:mx-0">
              Captive portal, pagamentos por PIX e cartão, LGPD e Marco Civil em um só sistema para provedores e estabelecimentos.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <LinkPainel to="/registro" className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 rounded-lg font-semibold shadow-lg shadow-orange-500/20">Começar teste grátis</LinkPainel>
              <a href={`https://wa.me/${WHATSAPP}`} rel="noopener" className="border border-apex-500 text-apex-700 hover:bg-apex-50 px-8 py-3 rounded-lg font-semibold inline-flex items-center justify-center gap-2">
                <MessageCircle size={18} /> Falar com a equipe
              </a>
            </div>
          </div>
          <div className="bg-white rounded-3xl shadow-2xl shadow-apex-500/20 border border-apex-100 p-6 max-w-sm mx-auto w-full">
            <div className="flex items-center gap-2 text-apex-700 font-semibold"><Wifi size={20} /> Portal Wi-Fi</div>
            <p className="mt-3 text-sm text-gray-500">Escolha seu acesso</p>
            {[["1 hora", "R$ 2,00"], ["1 dia", "R$ 5,00"], ["7 dias", "R$ 15,00"]].map(([t, v]) => (
              <div key={t} className="mt-3 flex items-center justify-between rounded-xl border border-apex-100 bg-apex-50 px-4 py-3">
                <span className="font-medium text-apex-900">{t}</span><span className="font-bold text-apex-600">{v}</span>
              </div>
            ))}
            <div className="mt-4 text-center bg-apex-500 text-white rounded-xl py-3 font-semibold">Pagar com PIX</div>
          </div>
        </div>
      </section>

      <section id="vantagens" className="py-12 sm:py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VANTAGENS.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="bg-white rounded-2xl p-4 sm:p-6 border border-apex-100 shadow-sm hover:shadow-md hover:border-apex-400 transition flex items-start gap-4 text-left sm:block sm:text-center">
              <span className="shrink-0 sm:mx-auto flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-apex-100"><Icone className="text-apex-500" size={28} /></span>
              <div className="min-w-0"><h3 className="sm:mt-3 font-bold text-lg text-apex-900">{titulo}</h3>
              <p className="mt-1 text-gray-600">{texto}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section id="como-funciona" aria-labelledby="como-funciona-titulo" className="py-12 sm:py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 id="como-funciona-titulo" className="text-2xl sm:text-3xl font-bold text-center text-balance">Como funciona o Wi&#8209;Fi com cadastro e pagamento</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {COMO_FUNCIONA.map(([titulo, texto], i) => (
              <li key={titulo} className="bg-white rounded-2xl p-6 border border-apex-100 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-apex-500 text-white font-bold" aria-hidden="true">{i + 1}</span>
                <h3 className="mt-3 font-bold text-apex-900">{titulo}</h3>
                <p className="mt-1 text-sm text-gray-600">{texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="recursos" className="py-12 sm:py-16 px-4 bg-apex-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-balance">Tudo incluído em todos os planos</h2>
          <p className="text-center text-gray-600 mt-2">Você não paga a mais por recurso: o plano muda só o tamanho da sua operação.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
              <div key={titulo} className="bg-white rounded-2xl p-4 sm:p-5 border border-apex-100 shadow-sm flex items-start gap-3 sm:block">
                <span className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full bg-apex-100"><Icone className="text-apex-500" size={22} /></span>
                <div className="min-w-0"><h3 className="sm:mt-3 font-bold text-apex-900">{titulo}</h3>
                <p className="mt-1 text-sm text-gray-600">{texto}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="py-12 sm:py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-balance">Escolha seu plano</h2>
          <p className="text-center text-gray-600 mt-2">Todos começam com 7 dias grátis e têm todos os recursos. Muda o limite de equipamentos e de administradores.</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {planos.map((p, i) => {
              const destaque = planos.length >= 3 && i === 1;
              return (
                <div key={p.id ?? p.nome} className={`rounded-2xl p-6 flex flex-col border-2 ${destaque ? "border-apex-500 shadow-xl" : "border-apex-100"}`}>
                  {destaque && <span className="self-start text-xs font-bold bg-apex-500 text-white px-3 py-1 rounded-full mb-2">Mais escolhido</span>}
                  <h3 className="text-2xl font-bold">{p.nome}</h3>
                  <p className="text-sm text-gray-500">{p.descricao}</p>
                  <p className="mt-3"><span className="text-4xl font-extrabold text-apex-900">{brl(p.valor)}</span><span className="text-gray-500">/{p.ciclo_dias === 30 ? "mês" : `${p.ciclo_dias} dias`}</span></p>
                  <ul className="mt-4 space-y-2 flex-1 text-sm">
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />{rotuloLimite(p.max_equipamentos, "equipamento", "equipamentos")}</li>
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />{rotuloLimite(p.max_admins, "administrador", "administradores")}</li>
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />Todos os recursos incluídos</li>
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />7 dias grátis, sem cartão</li>
                  </ul>
                  <LinkPainel to={cadastro(p)} className="mt-6 text-center bg-apex-500 hover:bg-apex-600 text-white py-3 rounded-lg font-semibold">Testar grátis</LinkPainel>
                </div>
              );
            })}
          </div>

          <div className="mt-10 hidden sm:block overflow-x-auto rounded-2xl border border-apex-100">
            <table className="w-full text-sm">
              <thead className="bg-apex-50 text-apex-900">
                <tr><th className="text-left px-4 py-3">Comparar</th>{planos.map((p) => <th key={p.id ?? p.nome} className="px-4 py-3 text-center">{p.nome}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-apex-100">
                {[["Valor", (p) => `${brl(p.valor)}/${p.ciclo_dias === 30 ? "mês" : `${p.ciclo_dias} dias`}`], ["Equipamentos", (p) => limite(p.max_equipamentos)], ["Administradores", (p) => limite(p.max_admins)], ["Recursos", () => "Todos"], ["Teste grátis", () => "7 dias"]].map(([rotulo, fn]) => (
                  <tr key={rotulo}><td className="px-4 py-3 font-medium text-apex-900">{rotulo}</td>{planos.map((p) => <td key={p.id ?? p.nome} className="px-4 py-3 text-center text-gray-700">{fn(p)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="faq" className="py-12 sm:py-16 px-4 bg-apex-50">
        <div className="max-w-3xl lg:max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-balance">Dúvidas frequentes</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border border-apex-100 bg-white rounded-lg p-4 open:shadow-sm hover:border-apex-400 transition">
                <summary className="font-semibold cursor-pointer list-none flex items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">{q}<span aria-hidden="true" className="text-apex-500 transition-transform group-open:rotate-180">&#9662;</span></summary>
                <p className="mt-2 text-gray-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-apex-900 text-apex-100 pt-8 pb-24 sm:pb-8 px-4 text-center text-sm">
        <p className="font-bold text-white">{nome}</p>
        <p className="mt-1">Atendimento: <a href={`https://wa.me/${WHATSAPP}`} className="underline hover:text-white">{TELEFONE}</a> (WhatsApp) | <a href={`mailto:${EMAIL}`} className="underline hover:text-white">{EMAIL}</a></p>
        <p className="mt-3 text-apex-400">&copy; {new Date().getFullYear()} {nome}. Todos os direitos reservados.</p>
      </footer>

      <a href={`https://wa.me/${WHATSAPP}`} aria-label="WhatsApp" className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 bg-green-500 hover:bg-green-600 text-white p-3.5 sm:p-4 rounded-full shadow-lg">
        <MessageCircle />
      </a>
    </div>
  );
}
