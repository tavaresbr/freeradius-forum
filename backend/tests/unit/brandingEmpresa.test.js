const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const PLAT = { nome: 'Apex', logo_url: '/uploads/logos/site-1.png', favicon_url: '/uploads/logos/favicon-1.png', apple_icon_url: null, tamanhos: { site: 'm', login: 'g', painel: 'm' } };

function setup(linhaEmpresa) {
  const db = criarDb(async (sql, params) => {
    if (/FROM empresas WHERE id/.test(sql)) return [[linhaEmpresa]];
  });
  const mod = carregar('src/controllers/brandingEmpresaController.js', { db });
  return { mod, db };
}

test('mesclar: o que a empresa nao enviou cai na plataforma; tamanhos so valem com logo propria', () => {
  const { mod } = setup({});
  const semLogo = mod.mesclar(PLAT, { logo_url: null, favicon_url: null, apple_icon_url: null, tamanhos: { site: 'xg', login: 'xg', painel: 'xg' } });
  assert.equal(semLogo.logo_url, PLAT.logo_url);
  assert.deepEqual(semLogo.tamanhos, PLAT.tamanhos);
  const comLogo = mod.mesclar(PLAT, { logo_url: '/uploads/logos/empresa-5-logo-1.png', favicon_url: null, apple_icon_url: null, tamanhos: { site: 'p', login: 'g', painel: 'xg' } });
  assert.equal(comLogo.logo_url, '/uploads/logos/empresa-5-logo-1.png');
  assert.equal(comLogo.favicon_url, PLAT.favicon_url);
  assert.equal(comLogo.tamanhos.painel, 'xg');
});

test('lerEmpresa le logo e branding_json da empresa informada', async () => {
  const { mod, db } = setup({ logo_url: '/uploads/logos/empresa-5-logo-1.png', branding_json: JSON.stringify({ favicon_url: '/uploads/logos/empresa-5-fav-1.png', tamanhos: { painel: 'g', login: 'lixo' } }) });
  const r = await mod.lerEmpresa(5);
  assert.equal(r.favicon_url, '/uploads/logos/empresa-5-fav-1.png');
  assert.deepEqual(r.tamanhos, { site: 'm', login: 'g', painel: 'g' }); // invalido cai no padrao
  assert.deepEqual(db.calls[0].params, [5]);
});

test('atualizarTamanhos recusa local e preset invalidos e so grava a empresa do token', async () => {
  const { mod, db } = setup({ logo_url: null, branding_json: null });
  let res = criarRes();
  await mod.atualizarTamanhos(criarReq({ empresa_id: 7, body: { tamanhos: { painel: 'gigante' } } }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await mod.atualizarTamanhos(criarReq({ empresa_id: 7, body: { tamanhos: { login: 'xg' } } }), res);
  assert.equal(res.statusCode, 200);
  const upd = db.calls.find((c) => /^UPDATE empresas SET branding_json/.test(c.sql));
  assert.equal(upd.params[1], 7);
  assert.equal(JSON.parse(upd.params[0]).tamanhos.login, 'xg');
});

test('coluna ausente (migration 062 nao rodada): lerEmpresa cai na logo e o PUT responde 503 com instrucao', async () => {
  const db = criarDb(async (sql) => {
    if (/branding_json/.test(sql)) { const e = new Error('Unknown column'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    if (/FROM empresas WHERE id/.test(sql)) return [[{ logo_url: '/x.png' }]];
  });
  const mod = carregar('src/controllers/brandingEmpresaController.js', { db });
  assert.equal((await mod.lerEmpresa(1)).logo_url, '/x.png');
  const res = criarRes();
  await mod.atualizarTamanhos(criarReq({ empresa_id: 1, body: { tamanhos: { login: 'p' } } }), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /062/);
});
