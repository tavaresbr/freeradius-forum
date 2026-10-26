const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let linhaBranding = null;
const chamadas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return [linhaBranding ? [{ config_json: linhaBranding }] : []];
    if (/INSERT INTO plataforma_configs/i.test(sql)) linhaBranding = params[0];
    return [{ affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const c = require('../../src/controllers/brandingController');
const resMock = () => { const r = { code: 200, headers: {} }; r.status = (x) => { r.code = x; return r; }; r.json = (b) => { r.body = b; return r; }; r.set = (k, v) => { r.headers[k] = v; }; return r; };
const reset = () => { linhaBranding = null; chamadas.length = 0; };

test('sem configuracao devolve o padrao Apex Telecom', async () => {
  reset();
  const res = resMock();
  await c.obter({}, res);
  assert.deepStrictEqual(res.body, { nome: 'Apex Telecom', logo_url: null, favicon_url: null, apple_icon_url: null, tamanhos: { site: 'm', login: 'g', painel: 'm' } });
});

test('validarNome: obrigatorio, limite e caracteres proibidos', () => {
  assert.match(c.validarNome('   ').erro, /Informe/);
  assert.match(c.validarNome('x'.repeat(61)).erro, /60/);
  assert.match(c.validarNome('<b>Oi</b>').erro, /não pode/);
  assert.strictEqual(c.validarNome('  Minha   Marca  ').nome, 'Minha Marca');
});

test('atualizarNome grava e preserva a logo; nome invalido nao grava', async () => {
  reset();
  linhaBranding = JSON.stringify({ nome: 'Antigo', logo_url: '/uploads/logos/site-1.png' });
  const res = resMock();
  await c.atualizarNome({ body: { nome: 'Nova Marca' } }, res);
  assert.deepStrictEqual(res.body, { nome: 'Nova Marca', logo_url: '/uploads/logos/site-1.png', favicon_url: null, apple_icon_url: null, tamanhos: { site: 'm', login: 'g', painel: 'm' } });

  chamadas.length = 0;
  const ruim = resMock();
  await c.atualizarNome({ body: { nome: '' } }, ruim);
  assert.strictEqual(ruim.code, 400);
  assert.ok(!chamadas.some((x) => /INSERT/.test(x.sql)));
});

test('removerLogo volta ao padrao e so apaga arquivos site-*', async () => {
  reset();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const original = c.DIRS.slice();
  c.DIRS[0] = tmp; c.DIRS[1] = tmp;
  fs.writeFileSync(path.join(tmp, 'site-9.png'), 'x');
  fs.writeFileSync(path.join(tmp, 'empresa-1.png'), 'x');

  linhaBranding = JSON.stringify({ nome: 'Apex Telecom', logo_url: '/uploads/logos/site-9.png' });
  const res = resMock();
  await c.removerLogo({}, res);
  assert.strictEqual(res.body.logo_url, null);
  assert.ok(!fs.existsSync(path.join(tmp, 'site-9.png')));

  // logo_url apontando para arquivo de empresa nunca e' apagado
  linhaBranding = JSON.stringify({ nome: 'X', logo_url: '/uploads/logos/empresa-1.png' });
  await c.removerLogo({}, resMock());
  assert.ok(fs.existsSync(path.join(tmp, 'empresa-1.png')));
  c.DIRS[0] = original[0]; c.DIRS[1] = original[1];
});

test('enviarLogo sem arquivo responde 400', async () => {
  reset();
  const res = resMock();
  await c.enviarLogo({}, res);
  assert.strictEqual(res.code, 400);
});

test('atualizar tamanhos: valida presets, preserva nome/logo e completa o que faltou', async () => {
  reset();
  linhaBranding = JSON.stringify({ nome: 'Marca', logo_url: '/uploads/logos/site-1.png' });
  const ok = resMock();
  await c.atualizar({ body: { tamanhos: { login: 'xg' } } }, ok);
  assert.strictEqual(ok.code, 200);
  assert.deepStrictEqual(ok.body, { nome: 'Marca', logo_url: '/uploads/logos/site-1.png', favicon_url: null, apple_icon_url: null, tamanhos: { site: 'm', login: 'xg', painel: 'm' } });

  chamadas.length = 0;
  for (const ruim of [{ tamanhos: { site: 'gigante' } }, { tamanhos: { rodape: 'm' } }, { tamanhos: 'x' }, {}]) {
    const r = resMock();
    await c.atualizar({ body: ruim }, r);
    assert.strictEqual(r.code, 400);
  }
  assert.ok(!chamadas.some((x) => /INSERT/.test(x.sql)));
});

test('enviarLogo e removerLogo preservam os tamanhos salvos', async () => {
  reset();
  linhaBranding = JSON.stringify({ nome: 'Marca', logo_url: null, tamanhos: { site: 'p', login: 'm', painel: 'g' } });
  const r = resMock();
  await c.removerLogo({}, r);
  assert.deepStrictEqual(r.body.tamanhos, { site: 'p', login: 'm', painel: 'g' });
});

test('favicon e icone do iPhone: grava, preserva o resto, troca apagando o anterior e remove', async () => {
  reset();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  const original = c.DIRS.slice();
  c.DIRS[0] = tmp; c.DIRS[1] = tmp;
  linhaBranding = JSON.stringify({ nome: 'Marca', logo_url: '/uploads/logos/site-1.png', favicon_url: '/uploads/logos/favicon-1.png' });
  fs.writeFileSync(path.join(tmp, 'favicon-1.png'), 'x');
  fs.writeFileSync(path.join(tmp, 'favicon-2.ico'), 'x');
  fs.writeFileSync(path.join(tmp, 'apple-1.png'), 'x');

  const r = resMock();
  await c.enviarFavicon({ file: { filename: 'favicon-2.ico' } }, r);
  assert.strictEqual(r.body.favicon_url, '/uploads/logos/favicon-2.ico');
  assert.strictEqual(r.body.logo_url, '/uploads/logos/site-1.png');
  assert.ok(!fs.existsSync(path.join(tmp, 'favicon-1.png')));

  const a = resMock();
  await c.enviarIconeApple({ file: { filename: 'apple-1.png' } }, a);
  assert.strictEqual(a.body.apple_icon_url, '/uploads/logos/apple-1.png');
  assert.strictEqual(a.body.favicon_url, '/uploads/logos/favicon-2.ico');

  const rm = resMock();
  await c.removerFavicon({}, rm);
  assert.strictEqual(rm.body.favicon_url, null);
  assert.strictEqual(rm.body.apple_icon_url, '/uploads/logos/apple-1.png');
  assert.ok(!fs.existsSync(path.join(tmp, 'favicon-2.ico')));
  await c.removerIconeApple({}, resMock());
  assert.ok(!fs.existsSync(path.join(tmp, 'apple-1.png')));
  c.DIRS[0] = original[0]; c.DIRS[1] = original[1];
});

test('enviarFavicon/enviarIconeApple sem arquivo respondem 400', async () => {
  for (const fn of [c.enviarFavicon, c.enviarIconeApple]) {
    const r = resMock();
    await fn({}, r);
    assert.strictEqual(r.code, 400);
  }
});

test('assinatura de ICO e PNG conferida (nao confia no mimetype)', () => {
  const { assinaturaConfere } = require('../../src/utils/campanhaValidacao');
  const ico = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);
  assert.ok(assinaturaConfere(ico, 'image/x-icon'));
  assert.ok(assinaturaConfere(ico, 'image/vnd.microsoft.icon'));
  assert.ok(!assinaturaConfere(Buffer.from('<svg xmlns=...>......'), 'image/x-icon'));
  assert.ok(!assinaturaConfere(ico, 'image/png'));
});
