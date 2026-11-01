// Login final/NAS no equipamento de onde o cliente veio (caso RB09: plano LGPD preso ao RB03).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const db = require('../../db');
const original = db.execute;
const { equipamentoDoCliente } = require('../../src/utils/leadUtils');
const plano = { id: 4, duracao_minutos: 60, mikrotik_id: 11, end_hotspot: 'hotspot.minharede.com' };

test.afterEach(() => { db.execute = original; });

test('usa o equipamento do cliente (mesma empresa) e mantem duracao/velocidade do plano', async () => {
  let args;
  db.execute = async (sql, p) => { args = p; return [[{ id: 18, end_hotspot: '10.5.50.1' }]]; };
  const r = await equipamentoDoCliente(1, '18', plano);
  assert.deepStrictEqual(args, [18, 1]);
  assert.strictEqual(r.mikrotik_id, 18);
  assert.strictEqual(r.end_hotspot, '10.5.50.1');
  assert.strictEqual(r.duracao_minutos, 60);
  assert.strictEqual(plano.mikrotik_id, 11, 'nao altera o objeto original');
});

test('equipamento de outra empresa, inexistente, invalido ou erro de banco: mantem o do plano', async () => {
  db.execute = async () => [[undefined]];
  assert.strictEqual(await equipamentoDoCliente(1, 99, plano), plano);
  assert.strictEqual(await equipamentoDoCliente(1, 'abc', plano), plano);
  assert.strictEqual(await equipamentoDoCliente(1, null, plano), plano);
  assert.strictEqual(await equipamentoDoCliente(null, 18, plano), plano);
  db.execute = async () => { throw new Error('db'); };
  assert.strictEqual(await equipamentoDoCliente(1, 18, plano), plano);
});

test('equipamento sem end_hotspot herda o do plano; LGPD e Lead usam o helper', async () => {
  db.execute = async () => [[{ id: 18, end_hotspot: null }]];
  const r = await equipamentoDoCliente(1, 18, plano);
  assert.strictEqual(r.mikrotik_id, 18);
  assert.strictEqual(r.end_hotspot, 'hotspot.minharede.com');
  for (const f of ['lgpdController.js', 'leadController.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../../src/controllers', f), 'utf8');
    assert.ok(src.includes('equipamentoDoCliente(empresaId, mikrotik_id, planoBase)'), f);
  }
});
