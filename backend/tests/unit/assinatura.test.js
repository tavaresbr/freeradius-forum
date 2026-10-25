const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado: respostas por trecho de SQL
const chamadas = [];
let respostas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    const r = respostas.find((x) => x.re.test(sql));
    return r ? r.out : [[], []];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const ass = require('../../src/utils/assinatura');
const middleware = require('../../src/middleware/assinatura');

const DIA = 86400000;
const agora = new Date('2026-06-15T12:00:00Z');
const em = (dias) => new Date(agora.getTime() + dias * DIA);
// obterStatus usa o relogio real
const emReal = (dias) => new Date(Date.now() + dias * DIA);

test('calcularEstado: trial valido, ativa, carencia e bloqueio', () => {
  const trial = ass.calcularEstado({ status: 'trial', trial_ate: em(3), carencia_dias: 3 }, agora);
  assert.strictEqual(trial.status, 'trial');
  assert.strictEqual(trial.bloqueada, false);
  assert.strictEqual(trial.dias_restantes, 3);

  const ativa = ass.calcularEstado({ status: 'ativa', vence_em: em(20), carencia_dias: 3 }, agora);
  assert.strictEqual(ativa.bloqueada, false);

  const carencia = ass.calcularEstado({ status: 'ativa', vence_em: em(-2), carencia_dias: 3 }, agora);
  assert.strictEqual(carencia.status, 'vencida');
  assert.strictEqual(carencia.em_carencia, true);
  assert.strictEqual(carencia.bloqueada, false);

  const bloqueada = ass.calcularEstado({ status: 'ativa', vence_em: em(-4), carencia_dias: 3 }, agora);
  assert.strictEqual(bloqueada.bloqueada, true);
});

test('calcularEstado: sem assinatura, cancelada e sem data bloqueiam', () => {
  assert.strictEqual(ass.calcularEstado(null, agora).bloqueada, true);
  assert.strictEqual(ass.calcularEstado({ status: 'cancelada', vence_em: em(30) }, agora).bloqueada, true);
  assert.strictEqual(ass.calcularEstado({ status: 'ativa', vence_em: null }, agora).bloqueada, true);
});

const resMock = () => {
  const r = { code: 200 };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

test('middleware: 402 para empresa vencida, passa ativa e super_admin', async () => {
  ass.invalidar();
  respostas = [{ re: /FROM assinaturas/, out: [[{ status: 'ativa', vence_em: emReal(-10), carencia_dias: 3 }]] }];
  const res = resMock(); let next = false;
  await middleware({ user: { role: 'owner' }, empresa_id: 1 }, res, () => { next = true; });
  assert.strictEqual(res.code, 402);
  assert.strictEqual(res.body.code, 'ASSINATURA_VENCIDA');
  assert.strictEqual(next, false);

  let nextSuper = false;
  await middleware({ user: { role: 'super_admin' }, empresa_id: 1 }, resMock(), () => { nextSuper = true; });
  assert.strictEqual(nextSuper, true);

  ass.invalidar();
  respostas = [{ re: /FROM assinaturas/, out: [[{ status: 'ativa', vence_em: emReal(10), carencia_dias: 3 }]] }];
  let nextOk = false;
  await middleware({ user: { role: 'owner' }, empresa_id: 2 }, resMock(), () => { nextOk = true; });
  assert.strictEqual(nextOk, true);
});

test('middleware: tabela inexistente nao derruba o painel', async () => {
  ass.invalidar();
  const orig = fakeDb.execute;
  fakeDb.execute = async () => { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; };
  let next = false;
  await middleware({ user: { role: 'owner' }, empresa_id: 9 }, resMock(), () => { next = true; });
  fakeDb.execute = orig;
  assert.strictEqual(next, true);
});

test('checarLimite: bloqueia no limite e libera plano ilimitado', async () => {
  ass.invalidar();
  respostas = [
    { re: /FROM assinaturas/, out: [[{ status: 'ativa', vence_em: emReal(10), max_equipamentos: 2, max_admins: null }]] },
    { re: /COUNT\(\*\) AS n FROM mikrotiks/, out: [[{ n: 2 }]] },
    { re: /COUNT\(\*\) AS n FROM admins/, out: [[{ n: 50 }]] },
  ];
  const eq = await ass.checarLimite(1, 'equipamentos');
  assert.strictEqual(eq.ok, false);
  assert.match(eq.mensagem, /Limite do plano/);
  const ad = await ass.checarLimite(1, 'admins');
  assert.strictEqual(ad.ok, true);
});

test('webhook: so a primeira aprovacao estende a assinatura (idempotente)', async () => {
  const axios = require('axios');
  const origGet = axios.get;
  axios.get = async () => ({ data: { id: 77, status: 'approved', transaction_amount: 99.9, external_reference: 'ass_5_emp_3' } });
  const ctrl = require('../../src/controllers/assinaturaController');
  const cobranca = { id: 5, empresa_id: 3, plano_id: 2, valor: 99.9, status: 'aguardando', mp_pagamento_id: '77' };
  let aprovacoes = 0;
  const base = [
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T', webhook_secret: '' }) }]] },
    { re: /SELECT \* FROM assinatura_cobrancas/, out: [[cobranca]] },
    { re: /SELECT ciclo_dias/, out: [[{ ciclo_dias: 30 }]] },
  ];
  const req = { body: { data: { id: '77' } }, query: {}, headers: {} };

  for (const affected of [1, 0]) {
    chamadas.length = 0;
    respostas = [...base, { re: /UPDATE assinatura_cobrancas SET status = 'aprovada'/, out: [{ affectedRows: affected }] }];
    const res = { sendStatus: (c) => { res.code = c; } };
    await ctrl.webhook(req, res);
    assert.strictEqual(res.code, 200);
    if (chamadas.some((c) => /INSERT INTO assinaturas/.test(c.sql))) aprovacoes++;
  }
  axios.get = origGet;
  assert.strictEqual(aprovacoes, 1);
});

test('webhook: valor divergente nao ativa', async () => {
  const axios = require('axios');
  const origGet = axios.get;
  axios.get = async () => ({ data: { id: 77, status: 'approved', transaction_amount: 1, external_reference: 'ass_5_emp_3' } });
  const ctrl = require('../../src/controllers/assinaturaController');
  chamadas.length = 0;
  respostas = [
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T' }) }]] },
    { re: /SELECT \* FROM assinatura_cobrancas/, out: [[{ id: 5, empresa_id: 3, plano_id: 2, valor: 99.9, status: 'aguardando', mp_pagamento_id: '77' }]] },
  ];
  const res = { sendStatus: (c) => { res.code = c; } };
  await ctrl.webhook({ body: { data: { id: '77' } }, query: {}, headers: {} }, res);
  axios.get = origGet;
  assert.ok(!chamadas.some((c) => /INSERT INTO assinaturas|SET status = 'aprovada'/.test(c.sql)));
});
