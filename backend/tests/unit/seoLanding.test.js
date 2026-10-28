// SEO/AEO/GEO da landing: gerador do plugin do Vite (frontend/src/seo/vitePluginSeo.js) a partir de siteSeo.js.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FRONT = path.resolve(__dirname, '../../../frontend');
const carregar = (rel) => import(pathToFileURL(path.join(FRONT, rel)).href);

test('JSON-LD: Organization, WebSite, SoftwareApplication e FAQPage validos e coerentes com a FAQ', async () => {
  const { gerarJsonLd } = await carregar('src/seo/vitePluginSeo.js');
  const { FAQ, SITE_URL } = await carregar('src/constants/siteSeo.js');
  const blocos = gerarJsonLd();
  assert.deepStrictEqual(blocos.map((b) => b['@type']), ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  for (const b of blocos) {
    assert.strictEqual(b['@context'], 'https://schema.org');
    JSON.parse(JSON.stringify(b));
  }
  const faq = blocos[3];
  assert.strictEqual(faq.mainEntity.length, FAQ.length);
  assert.deepStrictEqual(faq.mainEntity.map((q) => q.name), FAQ.map(([q]) => q));
  assert.ok(faq.mainEntity.every((q) => q.acceptedAnswer.text.length > 20));
  assert.ok(blocos[0].url === SITE_URL && SITE_URL.startsWith('https://'));
});

test('head e fallback estatico: canonical, robots, Open Graph e conteudo legivel sem JavaScript', async () => {
  const { gerarHead, gerarFallback } = await carregar('src/seo/vitePluginSeo.js');
  const { SITE_URL, FAQ } = await carregar('src/constants/siteSeo.js');
  const head = gerarHead();
  assert.match(head, new RegExp(`<link rel="canonical" href="${SITE_URL}/"`));
  assert.match(head, /<meta name="robots" content="index,follow/);
  assert.match(head, /property="og:image" content="https:\/\/[^"]+\/og-apex\.png"/);
  assert.strictEqual((head.match(/application\/ld\+json/g) || []).length, 4);
  // nenhum "<" solto dentro do JSON-LD (fecharia a tag script)
  for (const m of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    assert.ok(!m[1].includes('</'));
    JSON.parse(m[1]);
  }
  const fb = gerarFallback();
  assert.strictEqual((fb.match(/<h1>/g) || []).length, 1);
  assert.ok(FAQ.every(([q]) => fb.includes(q.replace(/&/g, '&amp;'))));
});

test('robots.txt, sitemap.xml e llms.txt: dominio canonico, areas privadas bloqueadas e rastreadores de IA liberados', async () => {
  const { gerarRobots, gerarSitemap, gerarLlmsTxt } = await carregar('src/seo/vitePluginSeo.js');
  const { SITE_URL } = await carregar('src/constants/siteSeo.js');
  const robots = gerarRobots();
  assert.match(robots, new RegExp(`Sitemap: ${SITE_URL}/sitemap.xml`));
  for (const p of ['/admin', '/super', '/api/', '/hotspot/']) assert.ok(robots.includes(`Disallow: ${p}`), p);
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.ok(robots.includes(`User-agent: ${bot}`), bot);
  const sitemap = gerarSitemap(new Date('2026-10-28T12:00:00Z'));
  assert.match(sitemap, /<loc>https:\/\/[^<]+\/<\/loc><lastmod>2026-10-28<\/lastmod>/);
  assert.ok(sitemap.includes(`${SITE_URL}/registro`) && !sitemap.includes('/admin'));
  const llms = gerarLlmsTxt();
  assert.ok(llms.startsWith('# ') && llms.includes(SITE_URL) && llms.includes('MikroTik'));
});
