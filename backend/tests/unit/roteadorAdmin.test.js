const test = require('node:test');
const assert = require('node:assert');
const { credenciaisRoteador, emStringRouterOS, linhasUsuarioRoteador } = require('../../src/utils/roteadorAdmin');

test('credenciais vem do ambiente; sem senha => null; usuario padrao admin', () => {
  assert.deepStrictEqual(credenciaisRoteador({}), { usuario: 'admin', senha: null });
  assert.deepStrictEqual(credenciaisRoteador({ ROUTER_ADMIN_USER: 'root', ROUTER_ADMIN_PASSWORD: 'x' }), { usuario: 'root', senha: 'x' });
});

test('escape RouterOS: so os caracteres especiais viram hex; > e + ficam', () => {
  assert.strictEqual(emStringRouterOS('Ab1>c+5X'), 'Ab1>c+5X');
  assert.strictEqual(emStringRouterOS('a"b\\c$d[e]f?'), 'a\\22b\\5Cc\\24d\\5Be\\5Df\\3F');
});

test('usuario admin: so troca a senha (sem /user add)', () => {
  const l = linhasUsuarioRoteador('admin', 'S3nha');
  assert.deepStrictEqual(l, ['/user set [find name="admin"] password="S3nha"']);
});

test('usuario dedicado: cria se faltar, limita a VPN, escapa aspas e nao mexe no admin', () => {
  const l = linhasUsuarioRoteador('painel', 'a"b$c');
  assert.strictEqual(l.length, 2);
  assert.match(l[0], /\/user find name="painel"\]\]=0\) do=\{ \/user add name="painel" group=full address=10\.8\.0\.0\/24/);
  assert.ok(l[0].includes('password="a\\22b\\24c"'));
  assert.ok(l[0].includes('else={ /user set [find name="painel"]'));
  assert.ok(!l.join('\n').includes('disabled'));
});
