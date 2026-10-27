// Dominio proprio do portal: validacao, DNS, certbot/nginx (com exec/fs falsos), host do portal e guarda de host.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes } = require('../helpers/mocks');

process.env.SYSTEM_DOMAIN = 'painel.apex.com.br';
process.env.SSL_EMAIL = 'ops@apex.com.br';
const dom = require('../../src/utils/dominioPortal');

test('validarDominio: aceita FQDN, normaliza e recusa o resto', () => {
  assert.deepStrictEqual(dom.validarDominio('  Wifi.Empresa.COM.br. '), { host: 'wifi.empresa.com.br' });
  for (const ruim of ['', '   ', 'localhost', '10.0.0.1', 'wifi.empresa.com.br:8080', 'https://wifi.empresa.com.br', 'a b.com',
    'wifi.empresa.com.br/x', 'painel.apex.com.br', 'x.painel.apex.com.br', 'a..com', '-a.com', 'a-.com', 'foo.local', 'foo', 'ação.com.br',
    'x'.repeat(64) + '.com', ('a.'.repeat(130)) + 'com', 'a.b.c.123', null, 42, '; rm -rf /', '$(id).com']) {
    assert.ok(dom.validarDominio(ruim).erro, `deveria recusar: ${ruim}`);
  }
});

test('verificarDns: CNAME para o sistema, A com o mesmo IP, IP de outro, sem registro', async () => {
  const mk = (t) => ({
    resolveCname: async (h) => (t.cname && h === 'wifi.x.com' ? t.cname : (() => { throw new Error('ENODATA'); })()),
    resolve4: async (h) => (h === 'painel.apex.com.br' ? ['200.1.1.1'] : (t.a || [])),
    resolve6: async () => [],
  });
  assert.strictEqual((await dom.verificarDns('wifi.x.com', { resolver: mk({ cname: ['painel.apex.com.br.'] }) })).tipo, 'CNAME');
  assert.strictEqual((await dom.verificarDns('wifi.x.com', { resolver: mk({ a: ['200.1.1.1'] }) })).tipo, 'A');
  const outro = await dom.verificarDns('wifi.x.com', { resolver: mk({ a: ['9.9.9.9'] }) });
  assert.strictEqual(outro.ok, false);
  assert.match(outro.mensagem, /9\.9\.9\.9/);
  const nada = await dom.verificarDns('wifi.x.com', { resolver: mk({}) });
  assert.strictEqual(nada.ok, false);
  assert.match(nada.mensagem, /Não encontramos/);
});

test('emitirCertificado: argumentos em array, sem shell, host validado e erro seguro', async () => {
  const chamadas = [];
  const exec = (cmd, args, opts, cb) => { chamadas.push({ cmd, args, opts }); cb(null, 'ok', ''); };
  await dom.emitirCertificado('wifi.empresa.com.br', { exec, webroot: '/dist' });
  assert.strictEqual(chamadas[0].cmd, 'certbot');
  assert.ok(Array.isArray(chamadas[0].args));
  assert.ok(chamadas[0].args.includes('wifi.empresa.com.br') && chamadas[0].args.includes('-w'));
  assert.ok(!('shell' in chamadas[0].opts));

  await assert.rejects(() => dom.emitirCertificado('x; rm -rf /', { exec }), /Informe|inválido/);
  assert.strictEqual(chamadas.length, 1, 'host invalido nem chega ao certbot');

  const falha = (c, a, o, cb) => cb(Object.assign(new Error('boom'), { stderr: 'segredo interno' }), '', 'segredo interno');
  const un = console.error; console.error = () => {};
  try {
    await assert.rejects(() => dom.emitirCertificado('wifi.empresa.com.br', { exec: falha }), (e) => e.seguro && !/segredo/.test(e.message));
  } finally { console.error = un; }
});

test('escreverVhost: renderiza so com host validado; nginx -t falho remove o arquivo', async () => {
  const escritos = {}; const removidos = [];
  const fsx = {
    readFileSync: (p) => require('node:fs').readFileSync(p, 'utf8'),
    writeFileSync: (p, c) => { escritos[p] = c; },
    unlinkSync: (p) => { removidos.push(p); },
  };
  const ok = (cmd, args, o, cb) => cb(null, '', '');
  const arq = await dom.escreverVhost('wifi.empresa.com.br', { exec: ok, fsx, dir: '/etc/nginx/conf.d' });
  assert.match(arq, /hotspot-dominio-wifi\.empresa\.com\.br\.conf$/);
  const conf = escritos[arq];
  assert.match(conf, /server_name wifi\.empresa\.com\.br;/);
  assert.match(conf, /live\/wifi\.empresa\.com\.br\/fullchain\.pem/);
  assert.match(conf, /location ~ \^\/\(admin\|super\|login\|registro\)/); // painel nunca abre no dominio do cliente
  assert.ok(!/\{\{/.test(conf), 'sem placeholders sobrando');
  assert.match(conf, /\$http_upgrade/, 'variaveis do nginx preservadas');

  const falhaNginx = (cmd, args, o, cb) => (cmd === 'nginx' && args[0] === '-t' ? cb(Object.assign(new Error('x'), { stderr: 'bad' }), '', 'bad') : cb(null, '', ''));
  const un = console.error; console.error = () => {};
  try {
    await assert.rejects(() => dom.escreverVhost('wifi.empresa.com.br', { exec: falhaNginx, fsx, dir: '/d' }), /nginx recusou/);
  } finally { console.error = un; }
  assert.strictEqual(removidos.length, 1, 'arquivo removido quando o nginx -t falha');
  await assert.rejects(() => dom.escreverVhost('a b', { exec: ok, fsx }), /inválido|Informe/);
});

test('portalHostDaEmpresa: dominio proprio so se ativo E com o recurso; senao plataforma', async () => {
  const mk = (linha) => criarDb(async () => [[linha]]);
  const tem = (v) => async () => v;
  dom.invalidarPortalHost();
  assert.strictEqual(await dom.portalHostDaEmpresa(1, { db: mk({ dominio_portal: 'wifi.x.com', dominio_status: 'ativo' }), temRecurso: tem(true) }), 'wifi.x.com');
  dom.invalidarPortalHost();
  assert.strictEqual(await dom.portalHostDaEmpresa(1, { db: mk({ dominio_portal: 'wifi.x.com', dominio_status: 'ativo' }), temRecurso: tem(false) }), 'painel.apex.com.br');
  dom.invalidarPortalHost();
  assert.strictEqual(await dom.portalHostDaEmpresa(1, { db: mk({ dominio_portal: 'wifi.x.com', dominio_status: 'dns_ok' }), temRecurso: tem(true) }), 'painel.apex.com.br');
  dom.invalidarPortalHost();
  const semColuna = criarDb(async () => { throw Object.assign(new Error('bad'), { code: 'ER_BAD_FIELD_ERROR' }); });
  assert.strictEqual(await dom.portalHostDaEmpresa(2, { db: semColuna, temRecurso: tem(true) }), 'painel.apex.com.br');
});

test('hostPortal: em dominio proprio login/registro do painel dao 404; na plataforma passa', () => {
  const mw = require('../../src/middleware/hostPortal');
  const roda = (hostname, path) => { const res = criarRes(); let seguiu = false; mw({ hostname, path }, res, () => { seguiu = true; }); return { seguiu, status: res.statusCode }; };
  assert.deepStrictEqual(roda('wifi.cliente.com.br', '/api/auth/login'), { seguiu: false, status: 404 });
  assert.strictEqual(roda('wifi.cliente.com.br', '/api/admin/login').seguiu, false);
  assert.strictEqual(roda('wifi.cliente.com.br', '/api/registro').seguiu, false);
  assert.strictEqual(roda('wifi.cliente.com.br', '/api/lgpd/login').seguiu, true);
  assert.strictEqual(roda('painel.apex.com.br', '/api/auth/login').seguiu, true);
  assert.strictEqual(roda('localhost', '/api/auth/login').seguiu, true);
});

test('rotas /api/dominio exigem o recurso; hotspot-login e walled garden usam o dominio da empresa', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require.resolve('../../server.js'), 'utf8');
  assert.match(server, /exigeRecurso\('dominio'\), require\("\.\/src\/routes\/dominioRoutes"\)/);
  assert.match(server, /portalHostDaEmpresa\(mikrotik\?\.empresa_id\)/);
  const setup = fs.readFileSync(require.resolve('../../src/utils/hotspotSetup.js'), 'utf8');
  assert.match(setup, /dominiosLiberados = \[\.\.\.new Set\(\[systemDomain, portalHost\]/);
});
