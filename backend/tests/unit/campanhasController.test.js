const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

// db falso com getConnection (reordenar usa transacao)
function montar(handler) {
  const db = criarDb(handler);
  const connCalls = [];
  db.getConnection = async () => ({
    beginTransaction: async () => connCalls.push('begin'),
    commit: async () => connCalls.push('commit'),
    rollback: async () => connCalls.push('rollback'),
    release: () => connCalls.push('release'),
    execute: async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      db.calls.push({ sql: s, params: params || [] });
      const r = await handler(s, params || []);
      return r === undefined ? [[]] : r;
    },
  });
  db.connCalls = connCalls;
  const ctrl = carregar('src/controllers/campanhasController.js', { db });
  return { db, ctrl };
}
// o util guarda a referencia ao db da primeira carga: descarta para pegar o db falso de cada teste
const descartarCacheCampanhaAtiva = () => { delete require.cache[require.resolve('../../src/utils/campanhaAtiva')]; };
const req = (over) => criarReq({ empresa_id: 7, ...over });

test('atualizar: descricao vazia LIMPA o campo e so altera o que veio', async () => {
  const { db, ctrl } = montar((sql) => {
    if (/^SELECT id.* FROM campanhas/.test(sql)) return [[{ id: 3 }]];
    if (/^SELECT \* FROM campanhas/.test(sql)) return [[{ id: 3, nome: 'x', descricao: null }]];
  });
  const res = criarRes();
  await ctrl.atualizar(req({ params: { id: '3' }, body: { descricao: '' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const up = db.calls.find((c) => /^UPDATE campanhas/.test(c.sql));
  assert.ok(up, 'fez UPDATE');
  assert.match(up.sql, /descricao = \?/);
  assert.doesNotMatch(up.sql, /nome = \?/);
  assert.strictEqual(up.params[0], null);
});

test('atualizar: nome null/vazio recusado (400) sem quebrar', async () => {
  const { db, ctrl } = montar(() => [[{ id: 3 }]]);
  const res = criarRes();
  await ctrl.atualizar(req({ params: { id: '3' }, body: { nome: null } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!db.calls.some((c) => /^UPDATE/.test(c.sql)));
});

test('atualizarItem: link javascript:, duracao fora da faixa e corpo vazio => 400 sem tocar no banco', async () => {
  const { db, ctrl } = montar(() => [{ affectedRows: 1 }]);
  for (const body of [{ link_destino: 'javascript:alert(1)' }, { duracao_segundos: 0 }, { duracao_segundos: 'abc' }, {}]) {
    const res = criarRes();
    await ctrl.atualizarItem(req({ params: { id: '3', itemId: '9' }, body }), res);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(body));
  }
  assert.strictEqual(db.calls.length, 0);
});

test('atualizarItem: titulo e link vazios limpam; filtra por empresa', async () => {
  const { db, ctrl } = montar((sql) => {
    if (/^UPDATE/.test(sql)) return [{ affectedRows: 1 }];
    return [[{ id: 9 }]];
  });
  const res = criarRes();
  await ctrl.atualizarItem(req({ params: { id: '3', itemId: '9' }, body: { titulo: '', link_destino: '', duracao_segundos: '8' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const up = db.calls.find((c) => /^UPDATE campanha_itens/.test(c.sql));
  assert.deepStrictEqual(up.params, [null, 8, null, '9', '3', 7]);
  assert.match(up.sql, /c\.empresa_id = \?/);
});

test('deletar: campanha em uso => 409 com a lista e nada e apagado; ?forcar=1 apaga', async () => {
  const { db, ctrl } = montar((sql) => {
    if (/^SELECT id.* FROM campanhas/.test(sql)) return [[{ id: 3 }]];
    if (/^SELECT id, nome FROM portais/.test(sql)) return [[{ id: 12, nome: 'Planos' }]];
    return [{ affectedRows: 1 }];
  });
  const res = criarRes();
  await ctrl.deletar(req({ params: { id: '3' } }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.deepStrictEqual(res.body.em_uso, [{ id: 12, nome: 'Planos' }]);
  assert.ok(!db.calls.some((c) => /^DELETE/.test(c.sql)));

  const res2 = criarRes();
  await ctrl.deletar(req({ params: { id: '3' }, query: { forcar: '1' } }), res2);
  assert.strictEqual(res2.statusCode, 200);
  assert.ok(db.calls.some((c) => /^DELETE FROM campanhas/.test(c.sql)));
});

test('reordenar: ids invalidos ou de outra campanha => 400 e nada e gravado', async () => {
  const { db, ctrl } = montar((sql) => {
    if (/^SELECT id.* FROM campanhas/.test(sql)) return [[{ id: 3 }]];
    if (/^SELECT id FROM campanha_itens/.test(sql)) return [[{ id: 1 }, { id: 2 }]];
    return [{ affectedRows: 1 }];
  });
  let res = criarRes();
  await ctrl.reordenar(req({ params: { id: '3' }, body: { ordens: [{ id: 'x', ordem: 0 }] } }), res);
  assert.strictEqual(res.statusCode, 400);

  res = criarRes();
  await ctrl.reordenar(req({ params: { id: '3' }, body: { ordens: [{ id: 1, ordem: 0 }, { id: 99, ordem: 1 }] } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(db.connCalls.includes('rollback'));
  assert.ok(!db.calls.some((c) => /^UPDATE campanha_itens/.test(c.sql)));

  res = criarRes();
  await ctrl.reordenar(req({ params: { id: '3' }, body: { ordens: [{ id: 2, ordem: 0 }, { id: 1, ordem: 1 }] } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(db.calls.filter((c) => /^UPDATE campanha_itens/.test(c.sql)).length, 2);
});

test('upload: campanha de outra empresa => 404 ANTES de gravar (middleware)', async () => {
  const db = criarDb(() => [[]]);
  const up = carregar('src/middleware/uploadCampanha.js', { db });
  const res = criarRes();
  let seguiu = false;
  await up.validarCampanhaDoUpload(req({ params: { id: '3' } }), res, () => { seguiu = true; });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(seguiu, false);
  assert.deepStrictEqual(db.calls[0].params, ['3', 7]);

  const db2 = criarDb(() => [[{ id: 3 }]]);
  const up2 = carregar('src/middleware/uploadCampanha.js', { db: db2 });
  await up2.validarCampanhaDoUpload(req({ params: { id: '3' } }), criarRes(), () => { seguiu = true; });
  assert.strictEqual(seguiu, true);
});

test('vincular campanha: inativa / sem itens / inexistente recusadas', async () => {
  const dbCtx = (linha) => criarDb((sql) => (/FROM portais/.test(sql) ? [[{ id: 1 }]] : /FROM campanhas c/.test(sql) ? [linha ? [linha] : []] : [{ affectedRows: 1 }]));
  for (const [linha, msg] of [[null, /não encontrada/], [{ ativo: 0, itens: 2 }, /inativa/], [{ ativo: 1, itens: 0 }, /sem itens/]]) {
    const db = dbCtx(linha);
    descartarCacheCampanhaAtiva();
    const portal = carregar('src/controllers/portalController.js', { db });
    const res = criarRes();
    await portal.vincularCampanha(req({ params: { portalId: '1' }, body: { campanha_ativa_id: 3 } }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.message, msg);
    assert.ok(!db.calls.some((c) => /^UPDATE portais/.test(c.sql)));
  }
  const db = dbCtx({ ativo: 1, itens: 2 });
  descartarCacheCampanhaAtiva();
  const portal = carregar('src/controllers/portalController.js', { db });
  const res = criarRes();
  await portal.vincularCampanha(req({ params: { portalId: '1' }, body: { campanha_ativa_id: 3 } }), res);
  assert.strictEqual(res.body.success, true);
});

test('listar: traz os portais que usam cada campanha (so da empresa)', async () => {
  const { db, ctrl } = montar(() => [[{ id: 1, nome: 'teste', total_itens: 3, portais_em_uso: 'Planos - Pagamento' }]]);
  const res = criarRes();
  await ctrl.listar(req(), res);
  assert.strictEqual(res.body.data[0].portais_em_uso, 'Planos - Pagamento');
  assert.match(db.calls[0].sql, /portais_em_uso/);
  assert.match(db.calls[0].sql, /p\.empresa_id = c\.empresa_id/);
  assert.deepStrictEqual(db.calls[0].params, [7]);
});
