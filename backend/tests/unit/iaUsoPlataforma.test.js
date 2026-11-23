// Uso da IA por empresa no /super: status por faixa, totais, mes invalido e tabela ausente.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const r = require('../../src/utils/iaUsoResumo');

test('statusDoUso: desligada, ok, perto (>=80%), esgotado e ilimitado', () => {
  assert.strictEqual(r.statusDoUso({ iaAtiva: false, respostas: 0, limite: 100 }), 'desligada');
  assert.strictEqual(r.statusDoUso({ iaAtiva: false, respostas: 5, limite: null }), 'ok'); // desligou depois de usar
  assert.strictEqual(r.statusDoUso({ iaAtiva: true, respostas: 79, limite: 100 }), 'ok');
  assert.strictEqual(r.statusDoUso({ iaAtiva: true, respostas: 80, limite: 100 }), 'perto');
  assert.strictEqual(r.statusDoUso({ iaAtiva: true, respostas: 100, limite: 100 }), 'esgotado');
  assert.strictEqual(r.statusDoUso({ iaAtiva: true, respostas: 99999, limite: null }), 'ok');
  assert.strictEqual(r.statusDoUso({ iaAtiva: true, respostas: 0, limite: 0 }), 'esgotado');
});

test('montarLinha e totais', () => {
  const a = r.montarLinha({ id: 1, nome: 'A', plano: 'Pro', iaAtiva: true, respostas: 50, limite: 200, tokensIn: 10, tokensOut: 5 });
  const b = r.montarLinha({ id: 2, nome: 'B', plano: null, iaAtiva: true, respostas: 0, limite: null, tokensIn: 0, tokensOut: 0 });
  assert.deepStrictEqual([a.pct, a.status, b.pct, b.limite], [25, 'ok', null, null]);
  assert.deepStrictEqual(r.totais([a, b]), { respostas: 50, tokens_in: 10, tokens_out: 5, empresas_com_uso: 1 });
});

test('mesValido', () => {
  assert.ok(r.mesValido('2026-11') && r.mesValido('2026-01'));
  for (const x of ['2026-13', '2026-00', '26-11', '2026-1', '', null, undefined, '2026-11; DROP']) assert.ok(!r.mesValido(x), String(x));
});

function ctrl(handler, status = {}) {
  const db = criarDb(handler);
  return carregar('src/controllers/plataformaController.js', { db, extras: {
    'src/utils/assinatura.js': { obterStatus: async (id) => status[id] || {}, tabelaInexistente: () => false },
  } });
}

test('GET ia-uso: mes invalido = 400; sem tabela = indisponivel; ok monta linhas e totais', async () => {
  let c = ctrl();
  let res = criarRes();
  await c.iaUso(criarReq({ query: { mes: '2026-99' } }), res);
  assert.strictEqual(res.statusCode, 400);

  c = ctrl(async (sql) => { if (/FROM empresas e/.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); });
  res = criarRes();
  await c.iaUso(criarReq({ query: { mes: '2026-11' } }), res);
  assert.strictEqual(res.body.indisponivel, true);

  c = ctrl(async (sql, p) => {
    if (/FROM empresas e/.test(sql)) { assert.strictEqual(p[0], '2026-11'); return [[
      { id: 1, nome: 'Alfa', plano: 'Pro', respostas: 90, tokens_in: 100, tokens_out: 50 },
      { id: 2, nome: 'Beta', plano: null, respostas: null, tokens_in: null, tokens_out: null },
    ]]; }
    if (/DISTINCT mes/.test(sql)) return [[{ mes: '2026-10' }]];
  }, { 1: { recursos: { ia: true }, ia_respostas_mes: 100 }, 2: { recursos: { ia: false } } });
  res = criarRes();
  await c.iaUso(criarReq({ query: { mes: '2026-11' } }), res);
  assert.deepStrictEqual(res.body.empresas.map((e) => e.status), ['perto', 'desligada']);
  assert.strictEqual(res.body.totais.respostas, 90);
  assert.deepStrictEqual(res.body.meses_disponiveis, ['2026-11', '2026-10']);
});
