const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const v = require('../../src/utils/campanhaValidacao');

const descartar = (rel) => { delete require.cache[require.resolve(rel)]; };
const req = (over) => criarReq({ empresa_id: 7, ...over });

test('validarData: aceita AAAA-MM-DD real, vazio = sem data, rejeita invalida', () => {
  assert.deepStrictEqual(v.validarData('2026-12-31', 'x'), { ok: true, valor: '2026-12-31' });
  assert.deepStrictEqual(v.validarData('', 'x'), { ok: true, valor: null });
  assert.strictEqual(v.validarData('2026-02-31', 'x').ok, false);
  assert.strictEqual(v.validarData('31/12/2026', 'x').ok, false);
});

test('validarJanela / validarFrequencia / dataISO', () => {
  assert.strictEqual(v.validarJanela('2026-05-02', '2026-05-01').ok, false);
  assert.strictEqual(v.validarJanela('2026-05-01', '2026-05-01').ok, true);
  assert.strictEqual(v.validarJanela(null, '2026-05-01').ok, true);
  assert.strictEqual(v.validarFrequencia('diaria').valor, 'diaria');
  assert.strictEqual(v.validarFrequencia('').valor, 'sempre');
  assert.strictEqual(v.validarFrequencia('toda hora').ok, false);
  assert.strictEqual(v.dataISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.strictEqual(v.dataISO(null), null);
});

test('campanhaAtivaInfo: SQL aplica a janela de datas e devolve a frequencia', async () => {
  const db = criarDb((sql) => (/FROM portais p/.test(sql) ? [[{ id: 5, frequencia: 'diaria' }]] : [[]]));
  descartar('../../src/utils/campanhaAtiva');
  const u = carregar('src/utils/campanhaAtiva.js', { db });
  assert.deepStrictEqual(await u.campanhaAtivaInfo(3), { id: 5, frequencia: 'diaria' });
  const sql = db.calls[0].sql;
  assert.match(sql, /c\.data_inicio IS NULL OR c\.data_inicio <= CURDATE\(\)/);
  assert.match(sql, /c\.data_fim IS NULL OR c\.data_fim >= CURDATE\(\)/);
  assert.strictEqual(await u.campanhaAtivaDoPortal(3), 5);
});

test('campanhaAtivaInfo: fora da janela (sem linha) = null', async () => {
  const db = criarDb(() => [[]]);
  descartar('../../src/utils/campanhaAtiva');
  const u = carregar('src/utils/campanhaAtiva.js', { db });
  assert.strictEqual(await u.campanhaAtivaInfo(3), null);
});

test('campanhaJaVista: le o cookie cv_<id> do cabecalho', () => {
  descartar('../../src/utils/campanhaAtiva');
  const u = carregar('src/utils/campanhaAtiva.js', { db: criarDb(() => [[]]) });
  assert.strictEqual(u.campanhaJaVista('a=1; cv_5=1; b=2', 5), true);
  assert.strictEqual(u.campanhaJaVista('cv_55=1', 5), false);
  assert.strictEqual(u.campanhaJaVista('cv_5=', 5), false);
  assert.strictEqual(u.campanhaJaVista(undefined, 5), false);
});

function ctrlCom(handler) {
  const db = criarDb(handler);
  return { db, ctrl: carregar('src/controllers/campanhasController.js', { db }) };
}

test('criar: grava datas e frequencia; janela invertida e frequencia invalida = 400', async () => {
  const { db, ctrl } = ctrlCom((sql) => (/^SELECT \* FROM campanhas/.test(sql) ? [[{ id: 1, data_inicio: new Date(2026, 4, 1), data_fim: null }]] : [{ insertId: 1 }]));
  const res = criarRes();
  await ctrl.criar(req({ body: { nome: 'A', data_inicio: '2026-05-01', data_fim: '2026-05-31', frequencia: 'sessao' } }), res);
  assert.strictEqual(res.statusCode, 201);
  assert.deepStrictEqual(db.calls.find((c) => /^INSERT INTO campanhas/.test(c.sql)).params, [7, 'A', null, '2026-05-01', '2026-05-31', 'sessao']);
  assert.strictEqual(res.body.data.data_inicio, '2026-05-01');

  for (const body of [{ nome: 'A', data_inicio: '2026-06-01', data_fim: '2026-05-01' }, { nome: 'A', frequencia: 'x' }, { nome: 'A', data_fim: 'abc' }]) {
    const r = criarRes();
    await ctrl.criar(req({ body }), r);
    assert.strictEqual(r.statusCode, 400);
  }
});

test('atualizar: data nova e conferida com a que ja estava gravada; vazio limpa', async () => {
  const { db, ctrl } = ctrlCom((sql) => {
    if (/^SELECT id.* FROM campanhas/.test(sql)) return [[{ id: 3, data_inicio: new Date(2026, 5, 10), data_fim: null }]];
    if (/^SELECT \* FROM campanhas/.test(sql)) return [[{ id: 3 }]];
  });
  let res = criarRes();
  await ctrl.atualizar(req({ params: { id: '3' }, body: { data_fim: '2026-06-01' } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!db.calls.some((c) => /^UPDATE campanhas/.test(c.sql)));

  res = criarRes();
  await ctrl.atualizar(req({ params: { id: '3' }, body: { data_inicio: '', frequencia: 'diaria' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const up = db.calls.find((c) => /^UPDATE campanhas/.test(c.sql));
  assert.match(up.sql, /data_inicio = \?/);
  assert.match(up.sql, /frequencia = \?/);
  assert.deepStrictEqual(up.params.slice(0, 2), [null, 'diaria']);
});
