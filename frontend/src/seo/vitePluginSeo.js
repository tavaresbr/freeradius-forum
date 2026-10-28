// Plugin do Vite: gera no build o <head> de SEO, o JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage),
// um resumo estatico dentro de <div id="root"> (para rastreadores que nao rodam JS, como os de IA) e os arquivos
// robots.txt, sitemap.xml e llms.txt, tudo a partir de src/constants/siteSeo.js.
import {
  SITE_URL, NOME, TITULO, DESCRICAO, RESUMO, WHATSAPP, TELEFONE, EMAIL, IDIOMA,
  EQUIPAMENTOS, COMO_FUNCIONA, RECURSOS, FAQ,
} from "../constants/siteSeo.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// "<" dentro do JSON-LD nao pode fechar a tag <script>
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

export function gerarJsonLd() {
  const organizacao = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organizacao`,
    name: NOME,
    url: SITE_URL,
    logo: `${SITE_URL}/og-apex.png`,
    email: EMAIL,
    telephone: "+55 93 99193-5695",
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", telephone: "+55 93 99193-5695", email: EMAIL, availableLanguage: "Portuguese", url: `https://wa.me/${WHATSAPP}` }],
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#site`,
    url: SITE_URL,
    name: NOME,
    inLanguage: IDIOMA,
    publisher: { "@id": `${SITE_URL}/#organizacao` },
  };
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: `${NOME} - Sistema de Wi-Fi Hotspot`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: RESUMO,
    url: SITE_URL,
    inLanguage: IDIOMA,
    featureList: RECURSOS.map((r) => `${r.titulo}: ${r.texto}`),
    publisher: { "@id": `${SITE_URL}/#organizacao` },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    inLanguage: IDIOMA,
    mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return [organizacao, site, software, faq];
}

export function gerarHead() {
  const og = `${SITE_URL}/og-apex.png`;
  return [
    `<title>${esc(TITULO)}</title>`,
    `<meta name="description" content="${esc(DESCRICAO)}" />`,
    `<link rel="canonical" href="${SITE_URL}/" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />`,
    `<meta name="theme-color" content="#0ea5e9" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:site_name" content="${esc(NOME)}" />`,
    `<meta property="og:title" content="${esc(TITULO)}" />`,
    `<meta property="og:description" content="${esc(DESCRICAO)}" />`,
    `<meta property="og:url" content="${SITE_URL}/" />`,
    `<meta property="og:image" content="${og}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(TITULO)}" />`,
    `<meta name="twitter:description" content="${esc(DESCRICAO)}" />`,
    `<meta name="twitter:image" content="${og}" />`,
    ...gerarJsonLd().map(jsonLd),
  ].join("\n    ");
}

// Resumo semantico que o React substitui ao montar. So aparece na raiz: em outras rotas o script o remove.
export function gerarFallback() {
  return `<div id="seo-fallback" style="max-width:760px;margin:0 auto;padding:24px 16px;font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
      <h1>${esc(NOME)}: sistema de Wi-Fi Hotspot com captive portal para provedores</h1>
      <p>${esc(RESUMO)}</p>
      <h2>Como funciona</h2>
      <ol>${COMO_FUNCIONA.map(([t, d]) => `<li><strong>${esc(t)}.</strong> ${esc(d)}</li>`).join("")}</ol>
      <h2>Recursos</h2>
      <ul>${RECURSOS.map((r) => `<li><strong>${esc(r.titulo)}:</strong> ${esc(r.texto)}</li>`).join("")}</ul>
      <h2>Equipamentos compatíveis</h2>
      <p>${esc(EQUIPAMENTOS.join(", "))}.</p>
      <h2>Dúvidas frequentes</h2>
      ${FAQ.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
      <h2>Contato</h2>
      <p>WhatsApp ${esc(TELEFONE)} · <a href="mailto:${esc(EMAIL)}">${esc(EMAIL)}</a> · <a href="${SITE_URL}/registro">Começar teste grátis de 7 dias</a></p>
    </div>
    <script>if(location.pathname!=="/"){var f=document.getElementById("seo-fallback");if(f)f.remove()}</script>`;
}

const ROBOTS_IA = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot"];
// Areas privadas ou do captive portal (acessadas pelo hotspot, nao por buscadores)
const PRIVADAS = ["/admin", "/super", "/api/", "/hotspot/", "/campanha/", "/pagamento", "/pagamentopix", "/lgpd", "/cadastro", "/lead", "/voucher", "/login-hotspot", "/planos-cliente", "/uploads/"];

export function gerarRobots() {
  const dis = PRIVADAS.map((p) => `Disallow: ${p}`).join("\n");
  const ia = ROBOTS_IA.map((b) => `User-agent: ${b}\nAllow: /\n${dis}\n`).join("\n");
  return `User-agent: *\nAllow: /\n${dis}\n\n${ia}\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

export function gerarSitemap(hoje = new Date()) {
  const data = hoje.toISOString().slice(0, 10);
  const url = (loc, prioridade) => `  <url><loc>${loc}</loc><lastmod>${data}</lastmod><changefreq>monthly</changefreq><priority>${prioridade}</priority></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${url(`${SITE_URL}/`, "1.0")}\n${url(`${SITE_URL}/registro`, "0.8")}\n</urlset>\n`;
}

export function gerarLlmsTxt() {
  return `# ${NOME}

> ${RESUMO}

## Páginas principais
- [Página inicial](${SITE_URL}/): recursos, planos, como funciona e dúvidas frequentes.
- [Criar conta e testar grátis por 7 dias](${SITE_URL}/registro): cadastro da empresa, sem cartão.

## Fatos sobre o produto
- Tipo: sistema web (SaaS) de Wi-Fi Hotspot com captive portal, multiempresa.
- Equipamentos compatíveis: ${EQUIPAMENTOS.join(", ")}.
- Pagamentos de acesso: PIX e cartão (Mercado Pago e EFI); liberação automática do acesso; acesso por voucher.
- Comunicação: mensagem automática por WhatsApp com as credenciais.
- Conformidade: aceite LGPD com o termo gravado e logs de conexão (Marco Civil) com exportação em CSV.
- Clientes: cadastro completo, importação por planilha ou SGP, sessões ativas e desconexão remota.
- Assinatura: teste grátis de 7 dias sem cartão; os planos variam no limite de equipamentos e de administradores. Preços atualizados na página inicial.

## Perguntas frequentes
${FAQ.map(([q, a]) => `- ${q} ${a}`).join("\n")}

## Contato
- WhatsApp: ${TELEFONE} (https://wa.me/${WHATSAPP})
- E-mail: ${EMAIL}
`;
}

export default function seoPlugin() {
  return {
    name: "apex-seo",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace(/<html[^>]*>/, `<html lang="${IDIOMA}">`)
          .replace(/<title>[\s\S]*?<\/title>/, "<!--seo-head-->")
          .replace("<!--seo-head-->", gerarHead())
          .replace('<div id="root"></div>', `<div id="root">${gerarFallback()}</div>`);
      },
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: gerarRobots() });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: gerarSitemap() });
      this.emitFile({ type: "asset", fileName: "llms.txt", source: gerarLlmsTxt() });
    },
  };
}
