const test = require('node:test');
const assert = require('node:assert');
const { criarDb } = require('../helpers/mocks');
const { calcularTrilha, trilhaDaEmpresa } = require('../../src/utils/trilhaAtivacao');

const fatosOk = () => ({
  nas: new Set(['10.8.0.2']),
  planos: { porEquipamento: new Map([[1, 1]]), semEquipamento: 0 },
  sessoes: new Map([[1, { total: 3, abertas: 1, primeira: '2026-10-01' }]]),
});
const est = (t, k) => t.etapas.find((e) => e.chave === k).estado;

test('mikrotik completo: tudo ok exceto conectividade (vem do teste ao vivo)', () => {
  const t = calcularTrilha({ id: 1, nome: 'RB', ip: '10.8.0.2', tipo: 'mikrotik', portal_id: 5, end_hotspot: 'h.x' }, fatosOk());
  assert.equal(t.total, 7);
  assert.equal(t.concluidas, 6);
  assert.equal(t.usuarios_ativos, 1);
});

test('mikrotik novo: pendencias com acao', () => {
  const t = calcularTrilha({ id: 9, ip: '1.1.1.1' }, { nas: new Set(), planos: { porEquipamento: new Map(), semEquipamento: 0 }, sessoes: new Map() });
  assert.equal(est(t, 'radius'), 'pendente');
  assert.equal(est(t, 'hotspot'), 'pendente');
  assert.equal(est(t, 'portal'), 'pendente');
  assert.equal(est(t, 'plano'), 'pendente');
  assert.equal(est(t, 'conexao'), 'pendente');
  assert.equal(t.concluidas, 1);
});

test('plano sem equipamento conta para todos', () => {
  const t = calcularTrilha({ id: 2, ip: 'x' }, { nas: new Set(), planos: { porEquipamento: new Map(), semEquipamento: 2 }, sessoes: new Map() });
  assert.equal(est(t, 'plano'), 'ok');
});

test('unifi: RADIUS nao se aplica e hotspot e manual com tutorial', () => {
  const t = calcularTrilha({ id: 3, ip: 'x', tipo: 'unifi' }, fatosOk());
  assert.equal(est(t, 'radius'), 'na');
  assert.equal(est(t, 'hotspot'), 'manual');
  assert.equal(t.etapas.find((e) => e.chave === 'hotspot').tutorial, 'tutorial-unifi');
  assert.equal(t.total, 6);
});

test('fatos indisponiveis viram desconhecido, sem lancar', () => {
  const t = calcularTrilha({ id: 4, ip: 'x', tipo: 'omada' }, {});
  assert.equal(est(t, 'radius'), 'desconhecido');
  assert.equal(est(t, 'plano'), 'desconhecido');
  assert.equal(est(t, 'conexao'), 'desconhecido');
});

test('trilhaDaEmpresa filtra toda query por empresa_id e tolera tabela ausente', async () => {
  const db = criarDb(async (sql) => {
    if (/FROM mikrotiks/.test(sql) && !/radacct/.test(sql)) return [[{ id: 1, nome: 'A', ip: '10.8.0.2', tipo: 'mikrotik' }]];
    if (/FROM radacct/.test(sql)) throw new Error("Table 'radacct' doesn't exist");
  });
  const orig = console.error; console.error = () => {};
  let out;
  try { out = await trilhaDaEmpresa(db, 777); } finally { console.error = orig; }
  assert.equal(out[1].etapas.find((e) => e.chave === 'conexao').estado, 'desconhecido');
  assert.ok(db.calls.length >= 4);
  for (const c of db.calls) {
    assert.match(c.sql, /empresa_id/i, c.sql);
    assert.ok(c.params.includes(777), c.sql);
  }
});
