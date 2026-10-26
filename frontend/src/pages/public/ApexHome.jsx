import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import SiteHeader from "../../components/public/SiteHeader";
import useBranding from "../../hooks/useBranding";
import { Wifi, Zap, ShieldCheck, BarChart3, Check, MessageCircle } from "lucide-react";

const WHATSAPP = "5593991935695";
const TELEFONE = "(93) 99193-5695";
const EMAIL = "adm@tavarestelecom.com.br";

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
const FAQ = [
  ["Como funciona o teste grátis?", "Você cria sua conta e usa o sistema por 7 dias, sem cartão. Depois escolhe um plano e paga por PIX."],
  ["Posso trocar de plano?", "Sim, a qualquer momento pelo menu Assinatura do painel."],
  ["E se eu atrasar o pagamento?", "Seus clientes continuam conectando. O painel administrativo fica bloqueado até a renovação."],
];

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const limite = (v) => (v == null ? "Ilimitados" : v);

export default function ApexHome() {
  const { nome } = useBranding();
  const [planos, setPlanos] = useState(PLANOS_FALLBACK);
  const { hash } = useLocation();

  // Vindo de /login ou /registro com /#planos: o React Router nao rola sozinho ate a ancora
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 50);
    return () => clearTimeout(t);
  }, [hash]);

  useEffect(() => {
    document.title = `${nome} | Sistema de Wi-Fi Hotspot para provedores`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = "Sistema de Wi-Fi Hotspot com captive portal, pagamentos PIX/cartão e conformidade LGPD. Teste grátis por 7 dias.";
  }, [nome]);

  useEffect(() => {
    fetch("/api/assinatura/planos")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d) && d.length) setPlanos(d); })
      .catch(() => {});
  }, []);

  const cadastro = (p) => (p?.id ? `/registro?plano=${p.id}` : "/registro");

  return (
    <div className="tema-site min-h-screen bg-white text-gray-800">
      <SiteHeader />

      <section id="topo" className="pt-32 pb-20 px-4 bg-gradient-to-br from-apex-50 via-white to-apex-100 text-apex-900">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div className="text-center md:text-left">
            <span className="inline-block text-xs font-semibold bg-apex-100 text-apex-700 px-3 py-1 rounded-full">7 dias grátis, sem cartão</span>
            <h1 className="mt-4 text-4xl md:text-5xl font-extrabold leading-tight">
              Wi-Fi Hotspot que <span className="text-apex-500">vende e cadastra</span> por você
            </h1>
            <p className="mt-5 text-lg text-gray-600 max-w-xl mx-auto md:mx-0">
              Captive portal, pagamentos por PIX e cartão, LGPD e Marco Civil em um só sistema para provedores e estabelecimentos.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <Link to="/registro" className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 rounded-lg font-semibold shadow-lg shadow-orange-500/20">Começar teste grátis</Link>
              <a href={`https://wa.me/${WHATSAPP}`} className="border border-apex-500 text-apex-700 hover:bg-apex-50 px-8 py-3 rounded-lg font-semibold inline-flex items-center justify-center gap-2">
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

      <section id="vantagens" className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VANTAGENS.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="bg-white rounded-2xl p-6 border border-apex-100 shadow-sm hover:shadow-md hover:border-apex-400 transition text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-apex-100"><Icone className="text-apex-500" size={28} /></span>
              <h3 className="mt-3 font-bold text-lg text-apex-900">{titulo}</h3>
              <p className="mt-1 text-gray-600">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="planos" className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center">Escolha seu plano</h2>
          <p className="text-center text-gray-600 mt-2">Todos começam com 7 dias grátis.</p>
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
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />{limite(p.max_equipamentos)} equipamento(s)</li>
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />{limite(p.max_admins)} administrador(es)</li>
                    <li className="flex items-center gap-2"><Check size={16} className="text-green-600" />Portal, pagamentos e LGPD</li>
                  </ul>
                  <Link to={cadastro(p)} className="mt-6 text-center bg-apex-500 hover:bg-apex-600 text-white py-3 rounded-lg font-semibold">Testar grátis</Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="py-16 px-4 bg-apex-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center">Dúvidas frequentes</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="border bg-white rounded-lg p-4">
                <summary className="font-semibold cursor-pointer">{q}</summary>
                <p className="mt-2 text-gray-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-apex-900 text-apex-100 py-8 px-4 text-center text-sm">
        <p className="font-bold text-white">{nome}</p>
        <p className="mt-1">Atendimento: <a href={`https://wa.me/${WHATSAPP}`} className="underline hover:text-white">{TELEFONE}</a> (WhatsApp) | <a href={`mailto:${EMAIL}`} className="underline hover:text-white">{EMAIL}</a></p>
        <p className="mt-3 text-apex-400">&copy; {new Date().getFullYear()} {nome}. Todos os direitos reservados.</p>
      </footer>

      <a href={`https://wa.me/${WHATSAPP}`} aria-label="WhatsApp" className="fixed bottom-5 right-5 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-lg">
        <MessageCircle />
      </a>
    </div>
  );
}
