// Acoes em massa na tela Clientes: so ids validos, sempre escopado por empresa_id.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const silencia = () => { const l = console.error; console.error = () => {}; return () => { console.error = l; }; };

function ctrl(db) {
  delete require.cache[require.resolve(path.join(ROOT, 'src/utils/leadUtils.js'))];
  return carregar('src/controllers/leadController.js', {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({}) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({}) },
    },
  });
}
const dbOk = () => criarDb(async (sql) => (/UPDATE leads|DELETE FROM leads/.test(sql) ? [{ affectedRows: 2 }] : undefined));

test('massa: recusa ids ausentes, invalidos, repetidos em excesso e lista grande', async () => {
  const db = dbOk();
  const c = ctrl(db);
  for (const ids of [undefined, [], 'x', [1, 'a'], [1, -2], [0], [1.5], [{}], Array.from({ length: 1001 }, (_, i) => i + 1)]) {
    const res = criarRes();
    await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids, status: 'novo' } }), res);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(ids)?.slice(0, 30));
    const res2 = criarRes();
    await c.deletarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids } }), res2);
    assert.strictEqual(res2.statusCode, 400);
  }
  assert.strictEqual(db.calls.length, 0);
});

test('massa: status invalido ou sem alteracao => 400', async () => {
  const c = ctrl(dbOk());
  let res = criarRes();
  await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids: [1], status: 'hacker' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids: [1] } }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('massa: status atualiza so da empresa do token, com ids como parametros', async () => {
  const db = dbOk();
  const c = ctrl(db);
  const res = criarRes();
  await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids: [3, '4', 3], status: 'contactado', empresa_id: 99 } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.afetados, 2);
  const up = db.calls.find((x) => /UPDATE leads/.test(x.sql));
  assert.match(up.sql, /WHERE empresa_id = \? AND id IN \(\?,\?\)/);
  assert.deepStrictEqual(up.params, ['contactado', 5, 3, 4]);
});

test('massa: opt-out grava a data ao ligar e limpa ao desligar', async () => {
  const db = dbOk();
  const c = ctrl(db);
  await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids: [1], whatsapp_optout: true } }), criarRes());
  await c.atualizarLeadsEmMassa(criarReq({ empresa_id: 5, body: { ids: [1], whatsapp_optout: false } }), criarRes());
  const [ligar, desligar] = db.calls.filter((x) => /UPDATE leads/.test(x.sql));
  assert.strictEqual(ligar.params[0], 1);
  assert.ok(ligar.params[1] instanceof Date);
  assert.strictEqual(desligar.params[0], 0);
  assert.strictEqual(desligar.params[1], null);
});

test('massa: exclusao escopada por empresa e erro de banco vira 500 generico', async () => {
  const db = dbOk();
  let c = ctrl(db);
  let res = criarRes();
  await c.deletarLeadsEmMassa(criarReq({ empresa_id: 7, body: { ids: [10, 11] } }), res);
  assert.strictEqual(res.statusCode, 200);
  const del = db.calls.find((x) => /DELETE FROM leads/.test(x.sql));
  assert.match(del.sql, /WHERE empresa_id = \? AND id IN \(\?,\?\)/);
  assert.deepStrictEqual(del.params, [7, 10, 11]);

  const volta = silencia();
  c = ctrl(criarDb(async () => { throw new Error('segredo do banco'); }));
  res = criarRes();
  await c.deletarLeadsEmMassa(criarReq({ empresa_id: 7, body: { ids: [1] } }), res);
  volta();
  assert.strictEqual(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('segredo'));
});
