const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const descartar = (rel) => { delete require.cache[require.resolve(rel)]; };

// Controller publico com db falso. dbHandler decide as respostas por SQL.
function publico(handler) {
  const db = criarDb(handler);
  descartar('../../src/utils/campanhaAtiva');
  descartar('../../src/utils/dedupeTtl');
  const ctrl = carregar('src/controllers/campanhasPublicController.js', { db });
  return { db, ctrl };
}
const base = (over = {}) => (sql) => {
  if (/FROM portais p\s+JOIN campanhas c/.test(sql)) return [[{ id: 5 }]];       // campanhaAtivaDoPortal
  if (/^SELECT empresa_id FROM portais/.test(sql)) return [[{ empresa_id: 7 }]];
  if (/FROM campanha_itens WHERE id = \?/.test(sql)) return [[{ id: 9, link_destino: 'https://x.com' }]];
  return [{ affectedRows: 1 }];
};
const req = (body, over = {}) => criarReq({ params: { portalId: '3' }, body, ip: '1.2.3.4', ...over });
const inserts = (db) => db.calls.filter((c) => /^INSERT INTO campanha_metricas/.test(c.sql));

test('view da campanha: conta 1x por sessao (views + metrica item 0); repeticao nao conta', async () => {
  const { db, ctrl } = publico(base());
  const r1 = criarRes();
  await ctrl.registrarView(req({ sessao: 'abc12345' }), r1);
  assert.strictEqual(r1.body.success, true);
  assert.ok(db.calls.some((c) => /^UPDATE campanhas SET views = views \+ 1/.test(c.sql)));
  assert.deepStrictEqual(inserts(db).map((c) => c.params), [[5, 7, 0]]);

  const r2 = criarRes();
  await ctrl.registrarView(req({ sessao: 'abc12345' }), r2);
  assert.strictEqual(r2.body.deduplicado, true);
  assert.strictEqual(inserts(db).length, 1);

  // outra sessao conta
  await ctrl.registrarView(req({ sessao: 'zzz98765' }), criarRes());
  assert.strictEqual(inserts(db).length, 2);
});

test('view de slide: valida o item da campanha e deduplica por item+sessao', async () => {
  const { db, ctrl } = publico(base());
  const r = criarRes();
  await ctrl.registrarView(req({ sessao: 'abc12345', item_id: 9 }), r);
  assert.strictEqual(r.body.success, true);
  assert.deepStrictEqual(inserts(db).map((c) => c.params), [[5, 7, 9]]);
  // item que nao e da campanha (SELECT vazio)
  const { ctrl: c2 } = publico((sql) => (/FROM campanha_itens WHERE id/.test(sql) ? [[]] : base()(sql)));
  const bad = criarRes();
  await c2.registrarView(req({ sessao: 'abc12345', item_id: 99 }), bad);
  assert.strictEqual(bad.statusCode, 400);
  // item_id lixo nao vira "view da campanha"
  for (const lixo of ['abc', 0, -1, 1.5]) {
    const x = criarRes();
    await ctrl.registrarView(req({ sessao: 'abc12345', item_id: lixo }), x);
    assert.strictEqual(x.statusCode, 400, String(lixo));
  }
});

test('campanha inutilizavel (inativa/sem itens/nao vinculada) nao conta nada', async () => {
  const { db, ctrl } = publico((sql) => (/FROM portais p\s+JOIN campanhas c/.test(sql) ? [[]] : base()(sql)));
  const r = criarRes();
  await ctrl.registrarView(req({ sessao: 'abc12345' }), r);
  assert.strictEqual(r.body.skipped, true);
  await ctrl.registrarClique(req({ sessao: 'abc12345', item_id: 9 }), criarRes());
  assert.strictEqual(inserts(db).length, 0);
  assert.ok(!db.calls.some((c) => /^UPDATE campanhas/.test(c.sql)));
});

test('sem sessao valida usa o IP como chave (clientes antigos nao contam em dobro)', async () => {
  const { db, ctrl } = publico(base());
  await ctrl.registrarView(req({}), criarRes());
  await ctrl.registrarView(req({ sessao: 'curto' }), criarRes()); // sessao invalida => cai no IP
  assert.strictEqual(inserts(db).length, 1);
});

test('clique: exige item com link, soma no item e no total, 1 por sessao', async () => {
  const { db, ctrl } = publico(base());
  const r = criarRes();
  await ctrl.registrarClique(req({ sessao: 'abc12345', item_id: 9 }), r);
  assert.strictEqual(r.body.success, true);
  assert.deepStrictEqual(inserts(db).map((c) => c.params), [[5, 7, 9], [5, 7, 0]]);
  assert.match(inserts(db)[0].sql, /cliques = cliques \+ 1/);

  const r2 = criarRes();
  await ctrl.registrarClique(req({ sessao: 'abc12345', item_id: 9 }), r2);
  assert.strictEqual(r2.body.deduplicado, true);
  assert.strictEqual(inserts(db).length, 2);

  // item sem link nao e clique
  const { db: db3, ctrl: c3 } = publico((sql) => (/FROM campanha_itens WHERE id/.test(sql) ? [[{ id: 9, link_destino: null }]] : base()(sql)));
  const r3 = criarRes();
  await c3.registrarClique(req({ sessao: 'abc12345', item_id: 9 }), r3);
  assert.strictEqual(r3.body.skipped, true);
  assert.strictEqual(inserts(db3).length, 0);

  const r4 = criarRes();
  await ctrl.registrarClique(req({ sessao: 'abc12345' }), r4);
  assert.strictEqual(r4.statusCode, 400);
});

// ---- admin: metricas ----
function admin(handler) {
  const db = criarDb(handler);
  const ctrl = carregar('src/controllers/campanhasController.js', { db });
  return { db, ctrl };
}
const rq = (query) => criarReq({ empresa_id: 7, params: { id: '5' }, query });

test('metricas: filtra por empresa, separa total (item 0) de itens e calcula % de clique', async () => {
  const { db, ctrl } = admin((sql) => {
    if (/^SELECT id.* FROM campanhas/.test(sql)) return [[{ id: 5 }]];
    if (/FROM campanha_metricas/.test(sql)) return [[
      { item_id: 0, dia: '2026-10-20', views: 10, cliques: 2 },
      { item_id: 0, dia: '2026-10-21', views: 30, cliques: 3 },
      { item_id: 9, dia: '2026-10-20', views: 8, cliques: 2 },
      { item_id: 9, dia: '2026-10-21', views: 12, cliques: 3 },
      { item_id: 77, dia: '2026-10-21', views: 5, cliques: 0 }, // item removido
    ]];
    if (/FROM campanha_itens/.test(sql)) return [[{ id: 9, titulo: 'Promo', tipo: 'imagem', arquivo_url: '/x.png' }, { id: 10, titulo: null, tipo: 'video', arquivo_url: '/y.mp4' }]];
  });
  const res = criarRes();
  await ctrl.metricas(rq({ de: '2026-10-20', ate: '2026-10-21' }), res);
  assert.strictEqual(res.statusCode, 200);
  const d = res.body.data;
  assert.deepStrictEqual(d.resumo, { views: 40, cliques: 5, ctr: 12.5 });
  assert.deepStrictEqual(d.por_dia.map((x) => [x.dia, x.views, x.cliques]), [['2026-10-20', 10, 2], ['2026-10-21', 30, 3]]);
  const i9 = d.por_item.find((i) => i.item_id === 9);
  assert.deepStrictEqual([i9.views, i9.cliques, i9.ctr], [20, 5, 25]);
  assert.strictEqual(d.por_item.find((i) => i.item_id === 10).views, 0);       // item sem dados aparece zerado
  assert.strictEqual(d.por_item.find((i) => i.item_id === 77).removido, true);  // historico de item removido
  const q = db.calls.find((c) => /FROM campanha_metricas/.test(c.sql));
  assert.deepStrictEqual(q.params, ['5', 7, '2026-10-20', '2026-10-21']);
  assert.match(q.sql, /empresa_id = \?/);
});

test('metricas: periodo invalido, longo demais e campanha de outra empresa', async () => {
  const { ctrl } = admin((sql) => (/^SELECT id.* FROM campanhas/.test(sql) ? [[]] : [[]]));
  for (const q of [{ de: '20/10/2026', ate: '2026-10-21' }, { de: '2026-10-21', ate: '2026-10-20' }, { de: '2024-01-01', ate: '2026-10-21' }, { de: '2026-13-45', ate: '2026-10-21' }]) {
    const res = criarRes();
    await ctrl.metricas(rq(q), res);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(q));
  }
  const res = criarRes();
  await ctrl.metricas(rq({ de: '2026-10-20', ate: '2026-10-21' }), res);
  assert.strictEqual(res.statusCode, 404);
});
