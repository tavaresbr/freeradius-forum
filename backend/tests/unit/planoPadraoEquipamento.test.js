const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { criarPlanoPadraoEquipamento, PLANO_EQUIPAMENTO_PADRAO } = require('../../src/utils/empresaSetup');

test('plano padrao do equipamento: valores, vinculo e idempotencia por equipamento', async () => {
  const chamadas = [];
  const ex = { execute: async (sql, params) => { chamadas.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  await criarPlanoPadraoEquipamento(ex, 7, 42, 'RB08');
  const { sql, params } = chamadas[0];
  assert.match(sql, /INSERT INTO planos/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM planos WHERE empresa_id = \? AND mikrotik_id = \? AND LOWER\(nome\) = LOWER\(\?\)\)/);
  // empresa, nome, descricao, duracao, down, up, equipamento, e os 3 do NOT EXISTS
  assert.deepStrictEqual(params, [7, 'Plano 60 minutos', 'Plano 60 minutos - RB08', 60, 20, 10, 42, 7, 42, 'Plano 60 minutos']);
  assert.strictEqual(PLANO_EQUIPAMENTO_PADRAO.nome, 'Plano 60 minutos');
});

test('sem nome do equipamento a descricao e so o nome do plano', async () => {
  const chamadas = [];
  const ex = { execute: async (sql, params) => { chamadas.push(params); return [{}]; } };
  await criarPlanoPadraoEquipamento(ex, 1, 2);
  assert.strictEqual(chamadas[0][2], 'Plano 60 minutos');
});

test('o cadastro de equipamento chama o helper dentro de try/catch (nao derruba o cadastro)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/routes/mikrotikRoutes.js'), 'utf8');
  const i = src.indexOf('criarPlanoPadraoEquipamento(db, req.empresa_id');
  assert.ok(i > 0, 'helper chamado no POST');
  const trecho = src.slice(Math.max(0, i - 80), i + 260);
  assert.match(trecho, /try \{/);
  assert.match(trecho, /catch \(errPlano\)/);
});
