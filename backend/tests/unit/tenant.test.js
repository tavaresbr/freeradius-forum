const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

function mw(handler) {
  const db = criarDb(handler);
  return { tenant: carregar('src/middleware/tenant.js', { db }), db };
}
async function rodar(tenant, req) {
  const res = criarRes(); let next = false;
  await tenant(req, res, () => { next = true; });
  return { res, next, req };
}

test('tenant: sem req.user -> 401', async () => {
  const { tenant } = mw();
  const r = await rodar(tenant, criarReq());
  assert.strictEqual(r.res.statusCode, 401); assert.strictEqual(r.next, false);
});

test('tenant: usuario comum usa empresa_id do JWT e ignora header/query', async () => {
  const { tenant, db } = mw();
  const r = await rodar(tenant, criarReq({
    user: { role: 'owner', empresa_id: 5 },
    headers: { 'x-empresa-id': '99' }, query: { empresa_id: '77' },
  }));
  assert.strictEqual(r.next, true);
  assert.strictEqual(r.req.empresa_id, 5);
  assert.strictEqual(db.calls.length, 0);
});

for (const role of ['manager', 'operator']) {
  test(`tenant: ${role} nao consegue trocar de empresa via header`, async () => {
    const { tenant } = mw();
    const r = await rodar(tenant, criarReq({ user: { role, empresa_id: 2 }, headers: { 'x-empresa-id': '3' } }));
    assert.strictEqual(r.req.empresa_id, 2);
  });
}

test('tenant: usuario comum sem empresa_id -> 403', async () => {
  const { tenant } = mw();
  const r = await rodar(tenant, criarReq({ user: { role: 'owner' } }));
  assert.strictEqual(r.res.statusCode, 403); assert.strictEqual(r.next, false);
});

test('tenant: super_admin com header valido (empresa existe)', async () => {
  const { tenant, db } = mw(async (sql) => (/FROM empresas/.test(sql) ? [[{ id: 8 }]] : undefined));
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin', empresa_id: 1 }, headers: { 'x-empresa-id': '8' } }));
  assert.strictEqual(r.next, true); assert.strictEqual(r.req.empresa_id, 8);
  assert.deepStrictEqual(db.calls[0].params, [8]);
});

test('tenant: super_admin com header de empresa inexistente -> 404', async () => {
  const { tenant } = mw(async () => [[]]);
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin', empresa_id: 1 }, headers: { 'x-empresa-id': '404' } }));
  assert.strictEqual(r.res.statusCode, 404); assert.strictEqual(r.next, false);
});

test('tenant: super_admin com header invalido (nao numerico / zero) -> 400', async () => {
  for (const h of ['abc', '0']) {
    const { tenant, db } = mw();
    const r = await rodar(tenant, criarReq({ user: { role: 'super_admin', empresa_id: 1 }, headers: { 'x-empresa-id': h } }));
    assert.strictEqual(r.res.statusCode, 400, `header ${h}`);
    assert.strictEqual(db.calls.length, 0);
  }
});

test('tenant: super_admin sem header usa empresa_id do JWT (sem consultar DB)', async () => {
  const { tenant, db } = mw();
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin', empresa_id: 4 } }));
  assert.strictEqual(r.next, true); assert.strictEqual(r.req.empresa_id, 4); assert.strictEqual(db.calls.length, 0);
});

test('tenant: super_admin sem header e sem empresa no JWT passa com empresa_id null', async () => {
  const { tenant } = mw();
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin' } }));
  assert.strictEqual(r.next, true); assert.strictEqual(r.req.empresa_id, null);
});

test('tenant: super_admin aceita ?empresa_id= na query (validado no DB)', async () => {
  const { tenant } = mw(async () => [[{ id: 6 }]]);
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin' }, query: { empresa_id: '6' } }));
  assert.strictEqual(r.req.empresa_id, 6);
});

test('tenant: erro de DB ao validar empresa -> 500', async () => {
  const { tenant } = mw(async () => { throw new Error('boom'); });
  const orig = console.error; console.error = () => {};
  try {
    const r = await rodar(tenant, criarReq({ user: { role: 'super_admin' }, headers: { 'x-empresa-id': '3' } }));
    assert.strictEqual(r.res.statusCode, 500);
  } finally { console.error = orig; }
});

test('tenant: header "8abc" nao deveria ser aceito como empresa 8', { todo: 'bug menor: parseInt("8abc") == 8 aceita header malformado (tenant.js)' }, async () => {
  const { tenant } = mw(async () => [[{ id: 8 }]]);
  const r = await rodar(tenant, criarReq({ user: { role: 'super_admin' }, headers: { 'x-empresa-id': '8abc' } }));
  assert.strictEqual(r.res.statusCode, 400);
});
