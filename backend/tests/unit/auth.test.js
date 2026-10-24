process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const auth = require('../../src/middleware/auth');
const { criarRes, criarReq } = require('../helpers/mocks');

function rodar(authorization) {
  const req = criarReq({ headers: authorization ? { authorization } : {} });
  const res = criarRes(); let next = false;
  auth(req, res, () => { next = true; });
  return { req, res, next };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('auth: sem token -> 401', () => {
  const r = rodar(); assert.strictEqual(r.res.statusCode, 401); assert.strictEqual(r.next, false);
});
test('auth: header sem Bearer token -> 401', () => {
  assert.strictEqual(rodar('Bearer').res.statusCode, 401);
});
test('auth: token na query string e ignorado', () => {
  const t = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const req = criarReq({ query: { token: t } }); const res = criarRes(); let next = false;
  auth(req, res, () => { next = true; });
  assert.strictEqual(res.statusCode, 401); assert.strictEqual(next, false);
});
test('auth: token invalido -> 403', () => {
  const r = rodar('Bearer lixo.lixo.lixo'); assert.strictEqual(r.res.statusCode, 403); assert.strictEqual(r.next, false);
});
test('auth: assinado com outro segredo -> 403', () => {
  assert.strictEqual(rodar('Bearer ' + jwt.sign({ id: 1 }, 'outro')).res.statusCode, 403);
});
test('auth: expirado -> 403', () => {
  const t = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.strictEqual(rodar('Bearer ' + t).res.statusCode, 403);
});
test('auth: alg none rejeitado', () => {
  const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, role: 'super_admin' })}.`;
  const r = rodar('Bearer ' + t); assert.strictEqual(r.res.statusCode, 403); assert.strictEqual(r.next, false);
});
test('auth: alg none com variacao de caixa ("None") rejeitado', () => {
  const t = `${b64({ alg: 'None', typ: 'JWT' })}.${b64({ id: 1, role: 'super_admin' })}.`;
  assert.strictEqual(rodar('Bearer ' + t).res.statusCode, 403);
});
test('auth: HS512 (fora da lista de algoritmos) rejeitado', () => {
  const t = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  assert.strictEqual(rodar('Bearer ' + t).res.statusCode, 403);
});
test('auth: token valido -> next e req.user preenchido', () => {
  const t = jwt.sign({ id: 3, role: 'owner', empresa_id: 9 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const r = rodar('Bearer ' + t);
  assert.strictEqual(r.next, true);
  assert.strictEqual(r.req.user.empresa_id, 9); assert.strictEqual(r.req.user.role, 'owner');
});
