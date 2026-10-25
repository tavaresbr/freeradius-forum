import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wifi, Zap, Headphones, Wrench, Check, Menu, X, MessageCircle } from "lucide-react";
import { validarCPF, mascaraCPF } from "../../utils/cpfUtils";

// Dados de exemplo: trocar por planos, precos e contatos reais.
const WHATSAPP = "5500000000000";
const PLANOS = [
  { nome: "100 Mega", preco: "69,90", itens: ["Fibra optica", "Wi-Fi incluso", "Suporte 24h"] },
  { nome: "300 Mega", preco: "89,90", destaque: true, itens: ["Fibra optica", "Wi-Fi 5 incluso", "Instalacao gratis", "Suporte 24h"] },
  { nome: "500 Mega", preco: "119,90", itens: ["Fibra optica", "Wi-Fi 6 incluso", "Instalacao gratis", "Suporte 24h"] },
  { nome: "1 Giga", preco: "199,90", itens: ["Fibra optica", "Wi-Fi 6 incluso", "IP fixo opcional", "Suporte prioritario"] },
];
const VANTAGENS = [
  { icone: Zap, titulo: "Velocidade real", texto: "Fibra optica ate a sua casa, sem limite de franquia." },
  { icone: Headphones, titulo: "Suporte humano", texto: "Atendimento rapido por WhatsApp e telefone." },
  { icone: Wrench, titulo: "Instalacao agil", texto: "Equipe propria agenda e instala em poucos dias." },
];
const FAQ = [
  ["Em quanto tempo instalam?", "Apos o pedido, nossa equipe entra em contato e agenda a instalacao, normalmente em ate 3 dias uteis."],
  ["Existe fidelidade?", "Consulte nossa equipe sobre as condicoes de cada plano."],
  ["Como funciona o pagamento?", "Boleto, PIX ou cartao, combinados no momento da contratacao."],
];

const soDigitos = (v) => v.replace(/\D/g, "");
const mascaraTel = (v) => {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const mascaraCep = (v) => {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

const VAZIO = {
  plano: "", nome: "", cpf: "", telefone: "", email: "", cep: "", logradouro: "",
  numero: "", bairro: "", cidade: "", uf: "", observacao: "", website: "", lgpd_aceite: false,
};

const inputCls = "w-full border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-orange-500 focus:outline-none";

export default function ApexHome() {
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    document.title = "Apex Telecom | Internet fibra optica";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = "Apex Telecom: internet de fibra optica rapida e estavel. Escolha seu plano e contrate online.";
  }, []);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const contratar = (nome) => {
    setForm((f) => ({ ...f, plano: nome }));
    setMenu(false);
    document.getElementById("contratar")?.scrollIntoView({ behavior: "smooth" });
  };

  const buscarCep = async () => {
    const cep = soDigitos(form.cep);
    if (cep.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d.erro) return;
      setForm((f) => ({
        ...f,
        logradouro: f.logradouro || d.logradouro || "",
        bairro: f.bairro || d.bairro || "",
        cidade: f.cidade || d.localidade || "",
        uf: f.uf || d.uf || "",
      }));
    } catch {
      /* preenchimento manual */
    }
  };

  const enviar = async (e) => {
    e.preventDefault();
    setErro("");
    if (!form.plano) return setErro("Escolha um plano.");
    if (!validarCPF(form.cpf)) return setErro("CPF invalido.");
    if (!form.lgpd_aceite) return setErro("Aceite o termo de privacidade para continuar.");
    setEnviando(true);
    try {
      const r = await fetch("/api/site/pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Nao foi possivel enviar seu pedido.");
      setEnviado(true);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const links = [["#planos", "Planos"], ["#vantagens", "Vantagens"], ["#faq", "Duvidas"], ["#contratar", "Contratar"]];

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <header className="fixed top-0 inset-x-0 z-40 bg-blue-950/95 backdrop-blur text-white">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <a href="#topo" className="flex items-center gap-2 font-bold text-xl">
            <Wifi className="text-orange-400" size={26} /> Apex<span className="text-orange-400">Telecom</span>
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {links.map(([h, t]) => <a key={h} href={h} className="hover:text-orange-300">{t}</a>)}
            <Link to="/login" className="text-blue-300 hover:text-white">Area restrita</Link>
            <button onClick={() => contratar("")} className="bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg font-semibold">Assine ja</button>
          </nav>
          <button className="md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X /> : <Menu />}</button>
        </div>
        {menu && (
          <nav className="md:hidden px-4 pb-4 flex flex-col gap-3 text-sm">
            {links.map(([h, t]) => <a key={h} href={h} onClick={() => setMenu(false)}>{t}</a>)}
            <Link to="/login" className="text-blue-300">Area restrita</Link>
          </nav>
        )}
      </header>

      <section id="topo" className="pt-32 pb-20 px-4 bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950 text-white">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight">
            Internet de fibra <span className="text-orange-400">sem limites</span>
          </h1>
          <p className="mt-5 text-lg md:text-xl text-blue-100 max-w-2xl mx-auto">
            Conexao rapida, estavel e com atendimento de verdade. Escolha seu plano e a gente cuida do resto.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#planos" className="bg-orange-500 hover:bg-orange-600 px-8 py-3 rounded-lg font-semibold">Ver planos</a>
            <a href={`https://wa.me/${WHATSAPP}`} className="border border-white/40 hover:bg-white/10 px-8 py-3 rounded-lg font-semibold inline-flex items-center justify-center gap-2">
              <MessageCircle size={18} /> Falar no WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section id="vantagens" className="py-16 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-3">
          {VANTAGENS.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <Icone className="mx-auto text-orange-500" size={36} />
              <h3 className="mt-3 font-bold text-lg">{titulo}</h3>
              <p className="mt-1 text-gray-600">{texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="planos" className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center">Escolha seu plano</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PLANOS.map((p) => (
              <div key={p.nome} className={`rounded-2xl p-6 flex flex-col border-2 ${p.destaque ? "border-orange-500 shadow-xl" : "border-gray-200"}`}>
                {p.destaque && <span className="self-start text-xs font-bold bg-orange-500 text-white px-3 py-1 rounded-full mb-2">Mais vendido</span>}
                <h3 className="text-2xl font-bold">{p.nome}</h3>
                <p className="mt-2"><span className="text-sm">R$</span> <span className="text-4xl font-extrabold text-blue-900">{p.preco}</span><span className="text-gray-500">/mes</span></p>
                <ul className="mt-4 space-y-2 flex-1">
                  {p.itens.map((i) => <li key={i} className="flex items-center gap-2 text-sm"><Check size={16} className="text-green-600" />{i}</li>)}
                </ul>
                <button onClick={() => contratar(p.nome)} className="mt-6 bg-blue-900 hover:bg-blue-800 text-white py-3 rounded-lg font-semibold">Contratar</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contratar" className="py-16 px-4 bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl p-6 md:p-8">
          {enviado ? (
            <div className="text-center py-8">
              <Check className="mx-auto text-green-600" size={48} />
              <h2 className="mt-3 text-2xl font-bold">Pedido recebido!</h2>
              <p className="mt-2 text-gray-600">Nossa equipe vai entrar em contato em breve para confirmar a instalacao do plano <b>{form.plano}</b>.</p>
              <button onClick={() => { setForm(VAZIO); setEnviado(false); }} className="mt-6 text-blue-700 underline">Fazer outro pedido</button>
            </div>
          ) : (
            <form onSubmit={enviar} className="space-y-4">
              <h2 className="text-2xl font-bold">Contrate agora</h2>
              <p className="text-gray-600 text-sm">Preencha seus dados e retornaremos para agendar a instalacao.</p>
              <select required value={form.plano} onChange={set("plano")} className={inputCls}>
                <option value="">Escolha o plano</option>
                {PLANOS.map((p) => <option key={p.nome} value={p.nome}>{p.nome} - R$ {p.preco}/mes</option>)}
              </select>
              <input required placeholder="Nome completo" value={form.nome} onChange={set("nome")} className={inputCls} autoComplete="name" />
              <div className="grid gap-4 sm:grid-cols-2">
                <input required placeholder="CPF" inputMode="numeric" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: mascaraCPF(e.target.value) }))} className={inputCls} />
                <input required placeholder="Telefone / WhatsApp" inputMode="tel" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: mascaraTel(e.target.value) }))} className={inputCls} autoComplete="tel" />
              </div>
              <input required type="email" placeholder="E-mail" value={form.email} onChange={set("email")} className={inputCls} autoComplete="email" />
              <div className="grid gap-4 sm:grid-cols-3">
                <input required placeholder="CEP" inputMode="numeric" value={form.cep} onChange={(e) => setForm((f) => ({ ...f, cep: mascaraCep(e.target.value) }))} onBlur={buscarCep} className={inputCls} />
                <input required placeholder="Endereco" value={form.logradouro} onChange={set("logradouro")} className={`${inputCls} sm:col-span-2`} />
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <input required placeholder="Numero" value={form.numero} onChange={set("numero")} className={inputCls} />
                <input required placeholder="Bairro" value={form.bairro} onChange={set("bairro")} className={`${inputCls} sm:col-span-3`} />
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <input required placeholder="Cidade" value={form.cidade} onChange={set("cidade")} className={`${inputCls} sm:col-span-3`} />
                <input required placeholder="UF" maxLength={2} value={form.uf} onChange={(e) => setForm((f) => ({ ...f, uf: e.target.value.toUpperCase() }))} className={inputCls} />
              </div>
              <textarea placeholder="Observacoes (opcional)" rows={2} value={form.observacao} onChange={set("observacao")} className={inputCls} />
              {/* honeypot anti-bot */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} className="hidden" aria-hidden="true" />
              <label className="flex items-start gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={form.lgpd_aceite} onChange={(e) => setForm((f) => ({ ...f, lgpd_aceite: e.target.checked }))} className="mt-1" />
                Concordo com o tratamento dos meus dados pessoais para contato comercial, conforme a LGPD.
              </label>
              {erro && <p className="text-red-600 text-sm" role="alert">{erro}</p>}
              <button disabled={enviando} className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white py-3 rounded-lg font-semibold">
                {enviando ? "Enviando..." : "Enviar pedido"}
              </button>
            </form>
          )}
        </div>
      </section>

      <section id="faq" className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center">Duvidas frequentes</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="border rounded-lg p-4">
                <summary className="font-semibold cursor-pointer">{q}</summary>
                <p className="mt-2 text-gray-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-blue-950 text-blue-200 py-8 px-4 text-center text-sm">
        <p className="font-bold text-white">Apex Telecom</p>
        <p className="mt-1">Atendimento: (00) 0000-0000 | contato@apextelecom.com.br</p>
        <p className="mt-3 text-blue-400">&copy; {new Date().getFullYear()} Apex Telecom. Todos os direitos reservados.</p>
      </footer>

      <a href={`https://wa.me/${WHATSAPP}`} aria-label="WhatsApp" className="fixed bottom-5 right-5 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-lg">
        <MessageCircle />
      </a>
    </div>
  );
}
