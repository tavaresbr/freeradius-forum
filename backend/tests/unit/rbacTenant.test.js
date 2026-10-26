const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes } = require('../helpers/mocks');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';

const authCtrl = () => carregar('src/controllers/authController.js', {
  db: criarDb(),
  extras: {
    'src/models/Admin.js': {
      findByEmail: async (e) => (e === 'ok@x.com'
        ? { id: 1, email: e, password: require('bcryptjs').hashSync('segredo', 4), role: 'owner', empresa_id: 1 }
        : undefined),
      getEmpresas: async () => [{ id: 1, nome: 'A', slug: 'a', role: 'owner' }],
      findById: async () => ({ id: 1, role: 'owner', empresa_id: 1 }),
    },
    'src/controllers/grupoPermissaoController.js': { getPermissoesConsolidadas: async () => ({}), MODULOS: [] },
  },
});

test('roleNaEmpresa: owner da casa vira o papel do vinculo em OUTRA empresa; super_admin segue super_admin', () => {
  const { roleNaEmpresa } = authCtrl();
  const user = { role: 'owner', empresa_id: 1 };
  assert.strictEqual(roleNaEmpresa(user, { id: 1, role: 'owner' }), 'owner');
  assert.strictEqual(roleNaEmpresa(user, { id: 2, role: 'operator' }), 'operator'); // nao herda owner
  assert.strictEqual(roleNaEmpresa({ role: 'super_admin', empresa_id: 1 }, { id: 2, role: 'owner' }), 'super_admin');
  assert.strictEqual(roleNaEmpresa(user, { id: 2 }), 'owner'); // vinculo sem role: mantem o fallback
});

test('login: e-mail inexistente e senha errada respondem igual (nao enumera usuarios)', async () => {
  const { login } = authCtrl();
  const r1 = criarRes(); await login({ body: { email: 'nao@x.com', password: 'x' } }, r1);
  const r2 = criarRes(); await login({ body: { email: 'ok@x.com', password: 'errada' } }, r2);
  assert.strictEqual(r1.statusCode, 401); assert.strictEqual(r2.statusCode, 401);
  assert.deepStrictEqual(r1.body, r2.body);
});

test('login: corpo sem senha/tipo invalido nao derruba (401 em vez de 500)', async () => {
  const { login } = authCtrl();
  for (const body of [{}, { email: 'ok@x.com' }, { email: { a: 1 }, password: 'x' }, undefined]) {
    const r = criarRes(); await login({ body }, r);
    assert.strictEqual(r.statusCode, 401);
  }
});

test('assinatura: erro de banco falha fechado (503); tabela inexistente segue', async () => {
  const mk = (err) => carregar('src/middleware/assinatura.js', {
    extras: { 'src/utils/assinatura.js': { obterStatus: async () => { throw err; }, tabelaInexistente: (e) => e.code === 'ER_NO_SUCH_TABLE' } },
  });
  let res = criarRes(); let seguiu = false;
  await mk(new Error('db caiu'))({ user: { role: 'owner' }, empresa_id: 1 }, res, () => { seguiu = true; });
  assert.strictEqual(res.statusCode, 503); assert.strictEqual(seguiu, false);

  res = criarRes(); seguiu = false;
  const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE';
  await mk(e)({ user: { role: 'owner' }, empresa_id: 1 }, res, () => { seguiu = true; });
  assert.strictEqual(seguiu, true);
});
