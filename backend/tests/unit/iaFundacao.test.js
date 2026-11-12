// Fundacao da IA (migration 077): uso mensal atomico, recurso fail-closed e cliente Claude.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarDb, carregar } = require('../helpers/mocks');

function carregarUso(handler) {
  const db = criarDb(handler);
  const uso = carregar('src/services/iaUso.js', { db, extras: { 'src/utils/assinatura.js': { obterStatus: async () => ({ ia_respostas_mes: 10 }) } } });
  return { uso, db };
}

test('reservar: ilimitado so conta e libera', async () => {
  const { uso, db } = carregarUso();
  assert.equal(await uso.reservar(1, null), true);
  assert.match(db.calls[0].sql, /ON DUPLICATE KEY UPDATE respostas = respostas \+ 1/);
});

test('reservar: limite 0 ou negativo nunca libera e nao toca o banco', async () => {
  const { uso, db } = carregarUso();
  assert.equal(await uso.reservar(1, 0), false);
  assert.equal(db.calls.length, 0);
});

test('reservar: UPDATE condicional (respostas < limite) decide', async () => {
  let afetadas = 1;
  const { uso, db } = carregarUso((sql) => (/^UPDATE ia_uso SET respostas = respostas \+ 1/.test(sql) ? [{ affectedRows: afetadas }] : [{}]));
  assert.equal(await uso.reservar(7, 5, '2026-11'), true);
  afetadas = 0;
  assert.equal(await uso.reservar(7, 5, '2026-11'), false);
  const up = db.calls.filter((c) => /^UPDATE ia_uso SET respostas = respostas \+ 1/.test(c.sql)).pop();
  assert.match(up.sql, /respostas < \?/);
  assert.deepEqual(up.params, [7, '2026-11', 5]);
});

test('reservar: tabela ausente = fail-closed (false)', async () => {
  const { uso } = carregarUso(() => { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; });
  assert.equal(await uso.reservar(1, 5), false);
  assert.equal(await uso.reservar(1, null), false);
});

test('situacao: restantes = limite - usadas', async () => {
  const { uso } = carregarUso((sql) => (/SELECT respostas/.test(sql) ? [[{ respostas: 4 }]] : undefined));
  const s = await uso.situacao(1, '2026-11');
  assert.deepEqual([s.usadas, s.limite, s.restantes], [4, 10, 6]);
});

test('claudeClient: sem chave nao esta disponivel e obterCliente lanca 503', () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const claude = require('../../src/services/claudeClient');
  assert.equal(claude.disponivel(), false);
  assert.throws(() => claude.obterCliente(), (e) => e.status === 503);
  if (antes) process.env.ANTHROPIC_API_KEY = antes;
});

test('claudeClient: modelos padrao e textoDe/tokensDe', () => {
  delete process.env.ANTHROPIC_MODEL_ATENDENTE; delete process.env.ANTHROPIC_MODEL;
  const claude = require('../../src/services/claudeClient');
  assert.equal(claude.modeloAtendente(), 'claude-opus-5-5');
  assert.equal(claude.modeloCopiloto(), 'claude-haiku-5-5');
  const r = { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'oi' }], usage: { input_tokens: 3, output_tokens: 2 } };
  assert.equal(claude.textoDe(r), 'oi');
  assert.deepEqual(claude.tokensDe(r), { entrada: 3, saida: 2 });
});
