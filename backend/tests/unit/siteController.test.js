const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const chamadas = [];
let existente = null;
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return [existente ? [existente] : []];
    return [{ affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const site = require('../../src/controllers/siteController');

const base = {
  plano: '300 Mega', nome: 'Maria Silva', cpf: '529.982.247-25', telefone: '(11) 98888-7777',
  email: 'maria@exemplo.com', cep: '01001-000', logradouro: 'Praca da Se', numero: '1',
  bairro: 'Se', cidade: 'Sao Paulo', uf: 'sp', lgpd_aceite: true,
};
const resMock = () => {
  const r = { code: 200 };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const reset = () => { chamadas.length = 0; existente = null; };

test('validarPedido rejeita CPF invalido e falta de aceite', () => {
  assert.match(site.validarPedido({ ...base, cpf: '111.111.111-11' }).erro, /CPF/);
  assert.match(site.validarPedido({ ...base, lgpd_aceite: false }).erro, /privacidade/);
  assert.strictEqual(site.validarPedido(base).erro, null);
});

test('empresa_id vem do ambiente, nunca do body', async () => {
  reset();
  process.env.SITE_EMPRESA_ID = '7';
  const res = resMock();
  await site.criarPedido({ body: { ...base, empresa_id: 99 } }, res);
  assert.strictEqual(res.code, 201);
  const ins = chamadas.find((c) => /INSERT INTO leads/.test(c.sql));
  assert.strictEqual(ins.params[0], 7);
  assert.strictEqual(ins.params[4], '52998224725');
});

test('CPF existente so anexa observacao, sem novo lead', async () => {
  reset();
  existente = { id: 5 };
  const res = resMock();
  await site.criarPedido({ body: base }, res);
  assert.strictEqual(res.body.success, true);
  assert.ok(chamadas.some((c) => /UPDATE leads SET observacoes/.test(c.sql)));
  assert.ok(!chamadas.some((c) => /INSERT INTO leads/.test(c.sql)));
});

test('honeypot preenchido nao grava nada', async () => {
  reset();
  const res = resMock();
  await site.criarPedido({ body: { ...base, website: 'x' } }, res);
  assert.strictEqual(chamadas.length, 0);
});
