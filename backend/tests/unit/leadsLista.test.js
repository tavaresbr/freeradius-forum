// Lista de clientes: colunas enxutas, paginacao ({itens,total}), filtros parametrizados, resumo por empresa,
// e a busca por telefone (coluna indexada quando existe, expressao antiga como fallback).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
function ctrl(db) {
  delete require.cache[require.resolve(path.join(ROOT, 'src/controllers/leadController.js'))];
  const nada = new Proxy({}, { get: () => () => {} });
  return carregar('src/controllers/leadController.js', {
    db,
    extras: {
      'src/utils/leadUtils.js': nada, 'src/services/whatsappNotify.js': { notificarLiberacao() {} },
      'src/gateways/gatewayLiberacao.js': nada, 'src/utils/apInfo.js': nada, 'src/utils/sessaoAtiva.js': nada,
    },
  });
}
const req = (query = {}) => criarReq({ empresa_id: 7, query });

test('lista sem limit: array completo, so colunas da lista (sem lgpd_termo/mac/ip), sempre por empresa', async () => {
  const db = criarDb(() => [[{ id: 1 }]]);
  const res = criarRes();
  await ctrl(db).listarLeads(req(), res);
  assert.deepStrictEqual(res.body, [{ id: 1 }]);
  const q = db.calls[0];
  assert.match(q.sql, /WHERE empresa_id = \? ORDER BY criado_em DESC, id DESC$/);
  assert.ok(!/SELECT \*/.test(q.sql));
  for (const col of ['lgpd_termo', ' mac', ' ip,', 'ap_mac', 'ssid']) assert.ok(!q.sql.includes(col), col);
  for (const col of ['nome', 'cpf', 'cnpj', 'telefone', 'whatsapp_optout', 'criado_em', 'sistema_origem', 'observacoes', 'data_nascimento']) assert.ok(q.sql.includes(col), col);
  assert.deepStrictEqual(q.params, [7]);
});

test('lista com limit: { itens, total, pagina, limite }, LIMIT/OFFSET e COUNT com o mesmo filtro', async () => {
  const db = criarDb((sql) => (/COUNT\(\*\)/.test(sql) ? [[{ total: 123 }]] : [[{ id: 1 }, { id: 2 }]]));
  const res = criarRes();
  await ctrl(db).listarLeads(req({ limit: '50', page: '3', status: 'novo', origem: 'whatsapp', q: '50%_x' }), res);
  assert.deepStrictEqual(res.body, { itens: [{ id: 1 }, { id: 2 }], total: 123, pagina: 3, limite: 50 });
  const [lista, conta] = db.calls;
  assert.match(lista.sql, /status = \?/);
  assert.match(lista.sql, /\(origem = \? OR sistema_origem = \?\)/);
  assert.match(lista.sql, /LIMIT \? OFFSET \?$/);
  assert.deepStrictEqual(lista.params.slice(0, 3), [7, 'novo', 'whatsapp']);
  assert.deepStrictEqual(lista.params.slice(-2), [50, 100]);
  assert.strictEqual(lista.params[4], '%50\\%\\_x%', '% e _ do usuario sao escapados');
  assert.ok(!/LIMIT/.test(conta.sql));
  assert.deepStrictEqual(conta.params, lista.params.slice(0, -2));
  const grande = criarRes();
  await ctrl(criarDb(() => [[{ total: 0 }]])).listarLeads(req({ limit: '999999' }), grande);
  assert.strictEqual(grande.body.limite, 1000, 'limite maximo');
});

test('filtros so aceitam texto (objeto/array no query nao vira SQL) e "todos" nao filtra', async () => {
  const db = criarDb(() => [[]]);
  await ctrl(db).listarLeads(req({ status: 'todos', origem: 'todas' }), criarRes());
  assert.deepStrictEqual(db.calls[0].params, [7]);
  const db2 = criarDb(() => [[]]);
  await ctrl(db2).listarLeads(req({ status: ['x'], q: { a: 1 }, origem: { $ne: 1 } }), criarRes());
  assert.deepStrictEqual(db2.calls[0].params, [7]);
});

test('resumo: contadores por status e origem, ambos filtrados por empresa; cada um ignora o proprio filtro', async () => {
  const db = criarDb((sql) => (/GROUP BY status/.test(sql)
    ? [[{ status: 'novo', total: 10 }, { status: 'convertido', total: 2 }]]
    : [[{ origem: 'whatsapp', total: 8 }, { origem: 'lgpd', total: 4 }, { origem: '', total: 0 }]]));
  const res = criarRes();
  await ctrl(db).resumoLeads(req({ status: 'novo', origem: 'whatsapp', q: 'ana' }), res);
  assert.deepStrictEqual(res.body, {
    total: 12,
    por_status: { novo: 10, contactado: 0, convertido: 2, descartado: 0 },
    por_origem: [{ origem: 'whatsapp', total: 8 }, { origem: 'lgpd', total: 4 }],
  });
  const [st, og] = db.calls;
  assert.match(st.sql, /empresa_id = \?/);
  assert.ok(!/status = \?/.test(st.sql), 'por_status ignora o filtro de status');
  assert.match(st.sql, /origem = \?/);
  assert.match(og.sql, /empresa_id = \?/);
  assert.match(og.sql, /status = \?/);
  assert.ok(!/\(origem = \?/.test(og.sql), 'por_origem ignora o filtro de origem');
  assert.strictEqual(st.params[0], 7);
  assert.strictEqual(og.params[0], 7);
});

test('erro de banco na lista vira 500 sem vazar detalhe', async () => {
  const fim = semLog();
  try {
    const res = criarRes();
    await ctrl(criarDb(() => { throw new Error('boom'); })).listarLeads(req(), res);
    assert.strictEqual(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.body).includes('boom'));
  } finally { fim(); }
});

test('telefoneBusca: usa a coluna indexada quando a migration 050 rodou; senao a expressao antiga; cache', async () => {
  const carregarBusca = (db) => {
    delete require.cache[require.resolve(path.join(ROOT, 'src/utils/telefoneBusca.js'))];
    return carregar('src/utils/telefoneBusca.js', { db });
  };
  let db = criarDb(() => [[{ n: 1 }]]);
  let b = carregarBusca(db);
  assert.strictEqual(await b.exprTelefoneFim10(), 'telefone_fim10');
  await b.exprTelefoneFim10();
  assert.strictEqual(db.calls.length, 1, 'segunda chamada vem do cache');
  db = criarDb(() => [[{ n: 0 }]]);
  b = carregarBusca(db);
  assert.strictEqual(await b.exprTelefoneFim10(), b.EXPR_ANTIGA);
  assert.match(b.EXPR_ANTIGA, /REGEXP_REPLACE/);
  db = criarDb(() => { throw new Error('sem acesso'); });
  b = carregarBusca(db);
  assert.strictEqual(await b.exprTelefoneFim10(), b.EXPR_ANTIGA, 'falha na checagem = expressao antiga');
});
