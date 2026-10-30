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

test('cartao: aprovado ativa 1x; recusado marca recusada; sem fingerprint e 400', async () => {
  const axios = require('axios');
  const pagCtrl = require('../../src/controllers/pagamentoController');
  const ctrl = require('../../src/controllers/assinaturaController');
  const origGet = axios.get; const origPost = axios.post;
  const resp = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const corpo = { plano_id: 2, card_number: '5031433215406351', cardholder_name: 'MARIA', expiration_month: 11, expiration_year: 2030,
                  security_code: '123', identification_number: '52998224725', device_session_id: 'armor.x' };
  const req = (b) => ({ body: b, empresa_id: 3, headers: { host: 'x.com' } });

  const semFp = resp();
  await ctrl.pagarCartao(req({ ...corpo, device_session_id: '' }), semFp);
  assert.strictEqual(semFp.code, 400);

  const base = [
    { re: /FROM saas_planos WHERE id = \? AND ativo/, out: [[{ id: 2, nome: 'Pro', valor: 99.9 }]] },
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T', public_key: 'PK' }) }]] },
    { re: /SELECT email FROM empresas/, out: [[{ email: 'a@b.com' }]] },
    { re: /INSERT INTO assinatura_cobrancas/, out: [{ insertId: 9 }] },
    { re: /SELECT \* FROM assinatura_cobrancas WHERE id/, out: [[{ id: 9, empresa_id: 3, plano_id: 2, valor: 99.9, status: 'aguardando', mp_pagamento_id: '55' }]] },
    { re: /SELECT ciclo_dias/, out: [[{ ciclo_dias: 30 }]] },
  ];
  // BIN lookup usa axios.get (installments); pagamento/tokens usam axios.post
  axios.get = async (url) => (/installments/.test(url)
    ? { data: [{ payment_method_id: 'master', payment_type_id: 'credit_card', issuer: { id: '24' } }] }
    : { data: { id: 55, status: 'approved', transaction_amount: 99.9, external_reference: 'ass_9_emp_3' } });
  axios.post = async (url) => (/card_tokens/.test(url) ? { data: { id: 'tok' } } : { data: { id: 55, status: 'approved' } });

  chamadas.length = 0;
  respostas = [...base, { re: /SET status = 'aprovada'/, out: [{ affectedRows: 1 }] }];
  const ok = resp();
  await ctrl.pagarCartao(req(corpo), ok);
  assert.strictEqual(ok.body.status, 'approved');
  assert.ok(chamadas.some((c) => /INSERT INTO assinaturas/.test(c.sql)));
  assert.ok(!JSON.stringify(chamadas).includes('5031433215406351'), 'numero do cartao nao pode ir ao banco');

  axios.post = async (url) => (/card_tokens/.test(url) ? { data: { id: 'tok' } } : { data: { id: 56, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' } });
  chamadas.length = 0;
  respostas = [...base];
  const rec = resp();
  await ctrl.pagarCartao(req(corpo), rec);
  assert.strictEqual(rec.code, 400);
  assert.match(rec.body.message, /Saldo insuficiente/);
  assert.ok(chamadas.some((c) => /SET status = 'recusada'/.test(c.sql)));
  assert.ok(!chamadas.some((c) => /INSERT INTO assinaturas/.test(c.sql)));

  axios.get = origGet; axios.post = origPost;
  void pagCtrl;
});

test('plano gratis nunca bloqueia, mesmo sem vencimento', () => {
  const { calcularEstado } = require('../../src/utils/assinatura');
  const e = calcularEstado({ status: 'ativa', vence_em: null, gratis: 1, plano_id: 1 });
  assert.strictEqual(e.bloqueada, false);
  assert.strictEqual(e.status, 'ativa');
  assert.strictEqual(e.gratis, true);
  assert.strictEqual(calcularEstado({ status: 'cancelada', gratis: 1 }).bloqueada, true);
});

test('diasDeTeste usa trial_dias ou o padrao 7', () => {
  const { diasDeTeste } = require('../../src/utils/assinatura');
  assert.strictEqual(diasDeTeste({ trial_dias: 30 }), 30);
  assert.strictEqual(diasDeTeste({ trial_dias: null }), 7);
  assert.strictEqual(diasDeTeste(null), 7);
  assert.strictEqual(diasDeTeste({ trial_dias: 9999 }), 365);
});

test('atualizarPlano sem a migration 047 regrava sem gratis/trial_dias e avisa', async () => {
  const ctrl = require('../../src/controllers/assinaturaController');
  const orig = fakeDb.execute;
  chamadas.length = 0;
  fakeDb.execute = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/gratis=/.test(sql)) { const e = new Error("Unknown column 'gratis'"); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return [{ affectedRows: 1 }];
  };
  const res = { json: (b) => { res.body = b; }, status: (c) => { res.code = c; return res; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 0, gratis: true }, params: { id: 1 } }, res);
  fakeDb.execute = orig;
  assert.strictEqual(res.code, undefined);
  assert.ok(res.body.aviso);
  assert.strictEqual(chamadas.length, 3);
  assert.ok(!/gratis/.test(chamadas[2].sql));
  assert.strictEqual(chamadas[2].params.length, 14);
});

test('atualizarPlano sem a migration 068 grava gratis/trial_dias sem exibir_site e avisa', async () => {
  const ctrl = require('../../src/controllers/assinaturaController');
  const orig = fakeDb.execute;
  chamadas.length = 0;
  fakeDb.execute = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/exibir_site/.test(sql)) { const e = new Error("Unknown column 'exibir_site'"); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return [{ affectedRows: 1 }];
  };
  const res = { json: (b) => { res.body = b; }, status: (c) => { res.code = c; return res; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 5, exibir_site: ['whatsapp', 'teste', 'invalido'] }, params: { id: 1 } }, res);
  fakeDb.execute = orig;
  assert.ok(/068/.test(res.body.aviso));
  assert.strictEqual(chamadas.length, 2);
  assert.ok(/gratis=/.test(chamadas[1].sql));
  assert.strictEqual(chamadas[0].params[15], JSON.stringify(['teste', 'whatsapp'].sort((a, b) => ['todos_recursos','teste','whatsapp'].indexOf(a) - ['todos_recursos','teste','whatsapp'].indexOf(b))));
});
