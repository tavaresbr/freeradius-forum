const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const m = require('../../src/utils/metricasPlataforma');

const AGORA = new Date(2026, 9, 30, 12, 0, 0); // 30/10/2026 (mes local)

test('periodoValido: so 7, 30 ou 90; o resto vira 30', () => {
  assert.equal(m.periodoValido('7'), 7);
  assert.equal(m.periodoValido('90'), 90);
  for (const v of ['abc', '0', '15', undefined, '-7']) assert.equal(m.periodoValido(v), 30);
});

test('preencherSerieDias completa dias sem dado com 0 e termina hoje', () => {
  const s = m.preencherSerieDias([{ dia: '2026-10-30', total: 5 }, { dia: '2026-10-28', total: '2' }], 3, AGORA);
  assert.deepEqual(s.map((x) => x.valor), [2, 0, 5]);
  assert.equal(s[2].chave, '2026-10-30');
  assert.equal(s[2].rotulo, '30/10');
  assert.equal(m.soma(s), 7);
});

test('preencherSerieMeses cobre os ultimos meses inclusive virada de ano', () => {
  const s = m.preencherSerieMeses([{ mes: '2026-10', total: 100 }, { mes: '2025-12', total: 40 }], 11, AGORA);
  assert.equal(s.length, 11);
  assert.equal(s[0].chave, '2025-12');
  assert.equal(s[0].valor, 40);
  assert.equal(s[10].chave, '2026-10');
  assert.equal(s[10].valor, 100);
  assert.equal(m.inicioSerieMeses(6, AGORA), '2026-05-01');
});

test('taxaConversao: sem base devolve null, senao percentual inteiro', () => {
  assert.equal(m.taxaConversao(0, 0), null);
  assert.equal(m.taxaConversao(3, 1), 33);
  assert.equal(m.taxaConversao('4', '4'), 100);
});

test('mrrDeAssinaturas ignora gratis, nao ativa e valor zero; ciclo proporcional', () => {
  const mrr = m.mrrDeAssinaturas([
    { status: 'ativa', valor: '100.00', ciclo_dias: 30, gratis: 0 },
    { status: 'ativa', valor: '300.00', ciclo_dias: 90, gratis: 0 },
    { status: 'ativa', valor: '50', ciclo_dias: 30, gratis: 1 },
    { status: 'trial', valor: '80', ciclo_dias: 30 },
    { status: 'ativa', valor: '0', ciclo_dias: 30 },
  ]);
  assert.equal(mrr, 200);
});

test('handler: bloco que falha vira null e os outros seguem; periodo invalido usa 30', async () => {
  const db = criarDb((sql) => {
    if (/FROM leads/i.test(sql) && /COUNT\(\*\) AS total/i.test(sql) && !/GROUP BY/i.test(sql)) throw new Error('boom');
    if (/FROM assinatura_cobrancas/i.test(sql) && /COALESCE\(SUM\(valor\), 0\) AS total, COUNT/i.test(sql)) return [[{ total: 150, n: 3 }]];
    if (/FROM assinaturas a JOIN saas_planos/i.test(sql)) return [[{ status: 'ativa', valor: 100, ciclo_dias: 30, gratis: 0 }]];
  });
  const c = carregar('src/controllers/plataformaController.js', {
    db,
    extras: { 'src/utils/donoPlataforma.js': { ehDonoPlataforma: async () => true, limparCacheDono() {} } },
  });
  const res = criarRes();
  await c.metricas(criarReq({ query: { dias: 'xx' } }), res);
  assert.equal(res.body.dias, 30);
  assert.equal(res.body.uso, null); // bloco com erro
  assert.equal(res.body.receita.faturado_periodo, 150);
  assert.equal(res.body.receita.ticket_medio, 50);
  assert.equal(res.body.receita.mrr, 100);
  assert.equal(res.body.receita.por_mes.length, 6);
  assert.notEqual(res.body.crescimento, null);
});
