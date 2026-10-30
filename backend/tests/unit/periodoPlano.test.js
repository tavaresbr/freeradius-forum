const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const chamadas = [];
let respostas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    const r = respostas.find((x) => x.re.test(sql));
    if (r && r.erro) { const e = new Error(r.erro); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return r ? r.out : [[], []];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const { mesesValidos, descontoDoPeriodo, valorDoPeriodo, normalizarDesconto } = require('../../src/utils/periodoPlano');
const ctrl = require('../../src/controllers/assinaturaController');

test('mesesValidos: so 1, 3, 6 e 12; o resto vira 1', () => {
  assert.deepStrictEqual([1, 3, 6, 12, 2, 0, -3, 24, 'x', undefined, '6'].map(mesesValidos), [1, 3, 6, 12, 1, 1, 1, 1, 1, 1, 6]);
});

test('valorDoPeriodo e descontoDoPeriodo', () => {
  const plano = { valor: 100, desconto_3m: 5, desconto_6m: '10', desconto_12m: 20 };
  assert.strictEqual(valorDoPeriodo(100, 1, descontoDoPeriodo(plano, 1)), 100);
  assert.strictEqual(valorDoPeriodo(100, 3, descontoDoPeriodo(plano, 3)), 285);
  assert.strictEqual(valorDoPeriodo(100, 6, descontoDoPeriodo(plano, 6)), 540);
  assert.strictEqual(valorDoPeriodo(100, 12, descontoDoPeriodo(plano, 12)), 960);
  assert.strictEqual(descontoDoPeriodo({ valor: 100 }, 12), 0); // sem coluna/valor = sem desconto
  assert.strictEqual(descontoDoPeriodo({ desconto_12m: 500 }, 12), 90); // teto
  assert.strictEqual(valorDoPeriodo(59.9, 12, 15), 610.98);
});

test('normalizarDesconto: vazio/invalido = null, teto 90', () => {
  assert.deepStrictEqual(['', null, undefined, 0, -5, 'abc', 12.345, 120].map(normalizarDesconto), [null, null, null, null, null, null, 12.35, 90]);
});

test('resolverItem: total do periodo vem do servidor (cliente nao define valor)', async () => {
  respostas = [{ re: /FROM saas_planos WHERE id/, out: [[{ id: 2, nome: 'Pro', valor: 100, desconto_12m: 20 }]] }];
  const { item } = await ctrl.resolverItem({ plano_id: 2, meses: 12, valor: 0.01 }, 1);
  assert.strictEqual(item.valor, 960);
  assert.strictEqual(item.cobranca.meses, 12);
  assert.match(item.titulo, /12 meses/);
  const mensal = (await ctrl.resolverItem({ plano_id: 2, meses: 7 }, 1)).item;
  assert.strictEqual(mensal.valor, 100);
  assert.strictEqual(mensal.cobranca.meses, 1);
});

test('cobranca de varios meses sem a migration 069 nao e criada', async () => {
  chamadas.length = 0;
  respostas = [
    { re: /FROM saas_planos WHERE id/, out: [[{ id: 2, nome: 'Pro', valor: 100, desconto_12m: 20 }]] },
    { re: /\(empresa_id, plano_id, valor, metodo, status, meses\)/, erro: "Unknown column 'meses'" },
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T' }) }]] },
    { re: /FROM empresas/, out: [[{ email: 'a@b.com' }]] },
  ];
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; } };
  await ctrl.criarCobranca({ body: { plano_id: 2, meses: 12 }, empresa_id: 1, headers: {}, get: () => '' }, res);
  assert.strictEqual(res.code, 500);
  assert.ok(!chamadas.some((c) => /INSERT INTO assinatura_cobrancas \(empresa_id, plano_id, valor, metodo, status\) /.test(c.sql)));
});

test('ativar cobranca de 12 meses estende 12 MONTH (e 1 mes segue igual)', async () => {
  const axios = require('axios');
  const origGet = axios.get;
  for (const [meses, esperado] of [[12, 12], [undefined, 1]]) {
    axios.get = async () => ({ data: { id: 77, status: 'approved', transaction_amount: 960, external_reference: 'ass_5_emp_3' } });
    chamadas.length = 0;
    respostas = [
      { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T', webhook_secret: '' }) }]] },
      { re: /SELECT \* FROM assinatura_cobrancas/, out: [[{ id: 5, empresa_id: 3, plano_id: 2, valor: 960, status: 'aguardando', mp_pagamento_id: '77', meses }]] },
      { re: /SELECT ciclo_dias/, out: [[{ ciclo_dias: 30 }]] },
      { re: /UPDATE assinatura_cobrancas SET status = 'aprovada'/, out: [{ affectedRows: 1 }] },
    ];
    const res = { sendStatus: (c) => { res.code = c; } };
    await ctrl.webhook({ body: { data: { id: '77' } }, query: {}, headers: {} }, res);
    const ins = chamadas.find((c) => /INSERT INTO assinaturas/.test(c.sql));
    assert.ok(ins, 'deve ativar');
    assert.match(ins.sql, /INTERVAL \? MONTH/);
    assert.deepStrictEqual(ins.params.slice(2), [esperado, esperado]);
  }
  axios.get = origGet;
});

test('salvar plano grava os descontos; sem a migration 069 avisa', async () => {
  chamadas.length = 0;
  respostas = [];
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 5, desconto_3m: '5', desconto_6m: '', desconto_12m: 20 }, params: { id: 1 } }, res);
  const up = chamadas.find((c) => /SET desconto_3m/.test(c.sql));
  assert.deepStrictEqual(up.params, [5, null, 20, 1]);
  assert.strictEqual(res.body.aviso, undefined);

  respostas = [{ re: /SET desconto_3m/, erro: "Unknown column 'desconto_3m'" }];
  const res2 = { status(c) { res2.code = c; return res2; }, json(b) { res2.body = b; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 5, desconto_12m: 20 }, params: { id: 1 } }, res2);
  assert.match(res2.body.aviso, /069/);
});

test('atualizarPlano com aplicar_todos copia os descontos so para planos pagos', async () => {
  chamadas.length = 0;
  respostas = [{ re: /WHERE COALESCE\(gratis, 0\) = 0/, out: [{ affectedRows: 4 }] }];
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 59.9, desconto_3m: 5, desconto_6m: 10, desconto_12m: 20, aplicar_todos: true }, params: { id: 2 } }, res);
  const geral = chamadas.find((c) => /COALESCE\(gratis, 0\) = 0/.test(c.sql));
  assert.deepStrictEqual(geral.params, [5, 10, 20]);
  assert.strictEqual(res.body.aplicados, 4);
});

test('atualizarPlano sem aplicar_todos nao mexe nos outros planos', async () => {
  chamadas.length = 0;
  respostas = [];
  const res = { status(c) { res.code = c; return res; }, json(b) { res.body = b; } };
  await ctrl.atualizarPlano({ body: { nome: 'Pop', valor: 59.9, desconto_3m: 5, aplicar_todos: false }, params: { id: 2 } }, res);
  assert.ok(!chamadas.some((c) => /COALESCE\(gratis/.test(c.sql)));
  assert.strictEqual(res.body.aplicados, null);
});
