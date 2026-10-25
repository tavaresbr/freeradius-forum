const test = require('node:test');
const assert = require('node:assert');
const { criarPlanosPadrao, PLANOS_PADRAO } = require('../../src/utils/empresaSetup');

function fakeExecutor() {
  const chamadas = [];
  return { chamadas, execute: async (sql, params) => { chamadas.push({ sql, params }); return [{ affectedRows: 1 }]; } };
}

test('criarPlanosPadrao cria LGPD e Lead da empresa, sem equipamento', async () => {
  const ex = fakeExecutor();
  await criarPlanosPadrao(ex, 9);
  assert.strictEqual(ex.chamadas.length, PLANOS_PADRAO.length);
  const nomes = ex.chamadas.map((c) => c.params[1]);
  assert.deepStrictEqual(nomes, ['LGPD', 'Lead']);
  for (const c of ex.chamadas) {
    assert.strictEqual(c.params[0], 9);
    assert.strictEqual(c.params[6], null); // mikrotik_id
    assert.strictEqual(c.params[7], 9);
    assert.deepStrictEqual(c.params.slice(3, 6), [60, 100, 50]); // minutos, down, up
  }
});

test('criarPlanosPadrao e idempotente (NOT EXISTS por empresa+nome) e aceita mikrotik_id', async () => {
  const ex = fakeExecutor();
  await criarPlanosPadrao(ex, 3, 42);
  for (const c of ex.chamadas) {
    assert.match(c.sql, /WHERE NOT EXISTS/);
    assert.strictEqual(c.params[6], 42);
  }
});
