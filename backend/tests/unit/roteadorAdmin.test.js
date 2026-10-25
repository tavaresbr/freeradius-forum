const test = require('node:test');
const assert = require('node:assert');
const { credenciaisRoteador, emStringRouterOS } = require('../../src/utils/roteadorAdmin');

test('credenciais vem do ambiente; sem senha => null; usuario padrao admin', () => {
  assert.deepStrictEqual(credenciaisRoteador({}), { usuario: 'admin', senha: null });
  assert.deepStrictEqual(credenciaisRoteador({ ROUTER_ADMIN_USER: 'root', ROUTER_ADMIN_PASSWORD: 'x' }), { usuario: 'root', senha: 'x' });
});

test('escape RouterOS: so os caracteres especiais viram hex; > e + ficam', () => {
  assert.strictEqual(emStringRouterOS('Ab1>c+5X'), 'Ab1>c+5X');
  assert.strictEqual(emStringRouterOS('a"b\\c$d[e]f?'), 'a\\22b\\5Cc\\24d\\5Be\\5Df\\3F');
});
