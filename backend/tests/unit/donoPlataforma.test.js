const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const chamadas = [];
let respostas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    const r = respostas.find((x) => x.re.test(sql));
    if (r && r.out instanceof Error) throw r.out;
    return r ? r.out : [[], []];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const { ehDonoPlataforma, limparCacheDono } = require('../../src/utils/donoPlataforma');
const exige = require('../../src/middleware/exigeDonoPlataforma');
const ctrl = require('../../src/controllers/plataformaController');

const resMock = () => {
  const r = { code: 200 };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const COUNT = (n) => ({ re: /SELECT COUNT\(\*\) AS n FROM admins/, out: [[{ n }]] });
const FLAG = (v) => ({ re: /SELECT dono_plataforma FROM admins/, out: [v === null ? [] : [{ dono_plataforma: v }]] });
const preparar = (...r) => { respostas = r; chamadas.length = 0; limparCacheDono(); };

test('dono com a flag passa', async () => {
  preparar(COUNT(1), FLAG(1));
  assert.strictEqual(await ehDonoPlataforma(1, 'super_admin'), true);
});

test('super admin sem a flag e bloqueado quando existe outro dono', async () => {
  preparar(COUNT(1), FLAG(0));
  assert.strictEqual(await ehDonoPlataforma(2, 'super_admin'), false);
  const res = resMock(); let seguiu = false;
  await exige({ user: { id: 2, role: 'super_admin' } }, res, () => { seguiu = true; });
  assert.strictEqual(res.code, 403);
  assert.strictEqual(seguiu, false);
});

test('rede de seguranca: ninguem com a flag => todo super admin e dono', async () => {
  preparar(COUNT(0));
  assert.strictEqual(await ehDonoPlataforma(2, 'super_admin'), true);
});

test('coluna ausente (migration 042 nao rodou) => compativel', async () => {
  const e = new Error('bad'); e.code = 'ER_BAD_FIELD_ERROR';
  preparar({ re: /FROM admins/, out: e });
  assert.strictEqual(await ehDonoPlataforma(3, 'super_admin'), true);
});

test('role que nao e super_admin nunca passa (nem consulta o banco)', async () => {
  preparar(COUNT(0));
  assert.strictEqual(await ehDonoPlataforma(1, 'owner'), false);
  assert.strictEqual(chamadas.length, 0);
});

test('erro de banco => 503, nao libera', async () => {
  preparar({ re: /FROM admins/, out: new Error('down') });
  const res = resMock(); let seguiu = false;
  await exige({ user: { id: 9, role: 'super_admin' } }, res, () => { seguiu = true; });
  assert.strictEqual(res.code, 503);
  assert.strictEqual(seguiu, false);
});

test('definirDono: alvo que nao e super_admin => 404', async () => {
  preparar({ re: /SELECT id, dono_plataforma FROM admins/, out: [[]] });
  const res = resMock();
  await ctrl.definirDono({ params: { id: '5' }, body: { dono: true } }, res);
  assert.strictEqual(res.code, 404);
  assert.ok(!chamadas.some((c) => /UPDATE admins/.test(c.sql)));
});

test('definirDono: nao remove o ultimo dono', async () => {
  preparar({ re: /SELECT id, dono_plataforma FROM admins/, out: [[{ id: 1, dono_plataforma: 1 }]] }, COUNT(1));
  const res = resMock();
  await ctrl.definirDono({ params: { id: '1' }, body: { dono: false } }, res);
  assert.strictEqual(res.code, 409);
  assert.ok(!chamadas.some((c) => /UPDATE admins/.test(c.sql)));
});

test('definirDono: concede e invalida o cache', async () => {
  preparar(COUNT(1), FLAG(0), { re: /SELECT id, dono_plataforma FROM admins/, out: [[{ id: 2, dono_plataforma: 0 }]] });
  assert.strictEqual(await ehDonoPlataforma(2, 'super_admin'), false);
  respostas = [COUNT(1), FLAG(1), respostas[2]];
  const res = resMock();
  await ctrl.definirDono({ params: { id: '2' }, body: { dono: true } }, res);
  assert.strictEqual(res.code, 200);
  assert.ok(chamadas.some((c) => /UPDATE admins SET dono_plataforma = \?/.test(c.sql) && c.params[0] === 1));
  assert.strictEqual(await ehDonoPlataforma(2, 'super_admin'), true);
});

// Todas as rotas da plataforma passam pelo middleware
const usa = (stack) => stack.some((l) => l.handle === exige);
test('rotas de SaaS/empresas/update/backup/logs exigem o dono', () => {
  const assin = require('../../src/routes/assinaturaRoutes');
  const admin = assin.stack.filter((l) => l.route && l.route.path.startsWith('/admin'));
  assert.ok(admin.length > 0);
  for (const l of admin) assert.ok(usa(l.route.stack), 'sem dono: ' + l.route.path);
  for (const f of ['empresaRoutes', 'systemUpdateRoutes', 'systemBackupRoutes', 'logsRoutes']) {
    const r = require('../../src/routes/' + f);
    assert.ok(usa(r.stack), f + ' sem exigeDonoPlataforma');
  }
  const pl = require('../../src/routes/plataformaRoutes');
  for (const l of pl.stack.filter((x) => x.route && x.route.path.startsWith('/donos'))) assert.ok(usa(l.route.stack));
});
