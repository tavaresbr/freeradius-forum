const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq, stub } = require('../helpers/mocks');
const authorize = require('../../src/middleware/authorize');

function rodarAuthorize(roles, user) {
  const res = criarRes(); let next = false;
  authorize(...roles)(criarReq({ user }), res, () => { next = true; });
  return { res, next };
}

test('authorize: role permitida passa', () => {
  assert.strictEqual(rodarAuthorize(['owner', 'super_admin'], { role: 'owner' }).next, true);
});
test('authorize: role nao listada -> 403', () => {
  const r = rodarAuthorize(['owner'], { role: 'operator' });
  assert.strictEqual(r.res.statusCode, 403); assert.strictEqual(r.next, false);
});
test('authorize: sem user -> 403', () => {
  assert.strictEqual(rodarAuthorize(['owner'], undefined).res.statusCode, 403);
});
test('authorize: sem roles permitidas nega todos (inclusive super_admin)', () => {
  assert.strictEqual(rodarAuthorize([], { role: 'super_admin' }).next, false);
});

// ---- checkPermissao ----
function montar({ total = 1, permissoes = {}, erro = false } = {}) {
  const db = criarDb(async (sql) => {
    if (erro) throw new Error('db down');
    if (/admin_grupos/.test(sql)) return [[{ total }]];
  });
  const consultas = [];
  const mw = carregar('src/middleware/checkPermissao.js', {
    db,
    extras: { 'src/controllers/grupoPermissaoController.js': { getPermissoesConsolidadas: async (id) => { consultas.push(id); return permissoes; } } },
  });
  return { mw, db, consultas };
}
async function rodarCheck(mw, modulo, req) {
  const res = criarRes(); let next = false;
  await mw(modulo)(req, res, () => { next = true; });
  return { res, next };
}

test('checkPermissao: super_admin bypass (sem DB)', async () => {
  const { mw, db } = montar();
  const r = await rodarCheck(mw, 'planos', criarReq({ method: 'DELETE', user: { id: 1, role: 'super_admin' } }));
  assert.strictEqual(r.next, true); assert.strictEqual(db.calls.length, 0);
});
test('checkPermissao: sem grupo -> 403 (deny-by-default)', async () => {
  const { mw } = montar({ total: 0 });
  const r = await rodarCheck(mw, 'planos', criarReq({ method: 'GET', user: { id: 2, role: 'owner' } }));
  assert.strictEqual(r.res.statusCode, 403); assert.strictEqual(r.next, false);
  assert.match(r.res.body.error, /sem grupo/i);
});
test('checkPermissao: mapeia metodo HTTP -> acao', async () => {
  const perms = { planos: { ver: true, criar: false, editar: true, excluir: false } };
  const esperado = { GET: true, POST: false, PUT: true, PATCH: true, DELETE: false };
  for (const [method, ok] of Object.entries(esperado)) {
    const { mw } = montar({ permissoes: perms });
    const r = await rodarCheck(mw, 'planos', criarReq({ method, user: { id: 3, role: 'manager' } }));
    assert.strictEqual(r.next, ok, method);
    if (!ok) assert.strictEqual(r.res.statusCode, 403);
  }
});
test('checkPermissao: modulo ausente nas permissoes -> 403', async () => {
  const { mw } = montar({ permissoes: { leads: { ver: true } } });
  const r = await rodarCheck(mw, 'planos', criarReq({ method: 'GET', user: { id: 3, role: 'manager' } }));
  assert.strictEqual(r.res.statusCode, 403);
});
test('checkPermissao: consulta grupo com admin_id do JWT', async () => {
  const { mw, db, consultas } = montar({ permissoes: { planos: { ver: true } } });
  await rodarCheck(mw, 'planos', criarReq({ method: 'GET', user: { id: 42, role: 'operator' } }));
  assert.deepStrictEqual(db.calls[0].params, [42]); assert.deepStrictEqual(consultas, [42]);
});
test('checkPermissao: erro de DB -> 500 (nao libera)', async () => {
  const { mw } = montar({ erro: true });
  const orig = console.error; console.error = () => {};
  try {
    const r = await rodarCheck(mw, 'planos', criarReq({ method: 'GET', user: { id: 1, role: 'owner' } }));
    assert.strictEqual(r.res.statusCode, 500); assert.strictEqual(r.next, false);
  } finally { console.error = orig; }
});
test('checkPermissao: metodo desconhecido (HEAD/OPTIONS) cai em "ver"', async () => {
  const { mw } = montar({ permissoes: { planos: { ver: true } } });
  const r = await rodarCheck(mw, 'planos', criarReq({ method: 'OPTIONS', user: { id: 1, role: 'owner' } }));
  assert.strictEqual(r.next, true);
});
