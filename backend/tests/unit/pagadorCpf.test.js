// Grilagem por pagamento: so um pagamento cujo PAGADOR e' o dono do CPF confirma esse CPF.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq } = require('../helpers/mocks');
const { normalizarCpfPagador, extrairCpfPagador, cpfCompativel } = require('../../src/utils/pagadorCpf');

const ROOT = path.resolve(__dirname, '..', '..');
const CPF = '52998224725';
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ---------- utilitario ----------
test('normalizarCpfPagador: so digitos e *, 11 posicoes e ao menos 4 digitos visiveis', () => {
  assert.strictEqual(normalizarCpfPagador('529.982.247-25'), '52998224725');
  assert.strictEqual(normalizarCpfPagador('***.982.247-**'), '***982247**');
  assert.strictEqual(normalizarCpfPagador('52998224725'), '52998224725');
  assert.strictEqual(normalizarCpfPagador('***.***.***-**'), null, 'tudo mascarado nao prova nada');
  assert.strictEqual(normalizarCpfPagador('***.***.247-**'), null, 'poucos digitos visiveis');
  assert.strictEqual(normalizarCpfPagador('1234'), null);
  assert.strictEqual(normalizarCpfPagador('abc.def.ghi-jk'), null);
  assert.strictEqual(normalizarCpfPagador(null), null);
});

test('extrairCpfPagador: prefere o dado do banco do PIX; cai em payer.identification; ausente => null', () => {
  const comBanco = { payer: { identification: { number: '11122233344' } },
    point_of_interaction: { transaction_data: { bank_info: { payer: { identification: { number: '***.982.247-**' } } } } } };
  assert.strictEqual(extrairCpfPagador(comBanco), '***982247**');
  assert.strictEqual(extrairCpfPagador({ payer: { identification: { number: '529.982.247-25' } } }), '52998224725');
  assert.strictEqual(extrairCpfPagador({ point_of_interaction: { transaction_data: { bank_info: { payer: { identification_number: '52998224725' } } } } }), '52998224725');
  assert.strictEqual(extrairCpfPagador({ payer: { email: 'a@b.com' } }), null);
  assert.strictEqual(extrairCpfPagador(null), null);
});

test('cpfCompativel: compara posicao a posicao ignorando o que o MP mascarou', () => {
  assert.strictEqual(cpfCompativel('52998224725', CPF), true);
  assert.strictEqual(cpfCompativel('***982247**', CPF), true);
  assert.strictEqual(cpfCompativel('***982248**', CPF), false);
  assert.strictEqual(cpfCompativel('11122233344', CPF), false);
  assert.strictEqual(cpfCompativel('***', CPF), false);
  assert.strictEqual(cpfCompativel('52998224725', '123'), false);
});

// ---------- webhook do PIX grava o CPF do pagador ----------
function webhook({ mp, cpfDoCadastro = CPF }) {
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { get: async () => ({ data: mp }), post: async () => ({ data: {} }) } };
  const db = criarDb(async (sql) => {
    if (/SELECT id, empresa_id, status FROM pagamentos WHERE mp_pagamento_id/.test(sql)) return [[{ id: 1, empresa_id: 5, status: 'aguardando' }]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: { access_token: 'APP_USR-x' } }]];
    if (/SELECT duracao_minutos FROM planos/.test(sql)) return [[{ duracao_minutos: 60 }]];
    if (/SELECT cpf FROM pagamentos WHERE mp_pagamento_id/.test(sql)) return [[{ cpf: cpfDoCadastro }]];
    return undefined;
  });
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k];
  const mod = carregar('src/controllers/pagamentoController.js', { db });
  return { db, mod };
}
const rodar = async (mod) => {
  const res = { sendStatus(c) { this.codigo = c; return this; } };
  await mod.notificacaoWebhook(criarReq({ body: { type: 'payment', data: { id: 999 } }, headers: {} }), res);
  return res;
};
const mpAprovado = (extra = {}) => ({ id: 999, status: 'approved', description: 'Plano 1h', transaction_amount: 5, payer: { email: 'x@y.com' }, ...extra });
const gravouPagador = (db) => db.calls.find((c) => /UPDATE pagamentos SET pagador_cpf/.test(c.sql));

test('webhook PIX: grava o CPF do pagador informado pelo banco (so se ainda NULL)', async () => {
  const { db, mod } = webhook({ mp: mpAprovado({ point_of_interaction: { transaction_data: { bank_info: { payer: { identification: { number: '529.982.247-25' } } } } } }) });
  const un = silencia(); try { await rodar(mod); } finally { un(); }
  const u = gravouPagador(db);
  assert.ok(u, 'gravou');
  assert.match(u.sql, /pagador_cpf IS NULL/);
  assert.deepStrictEqual(u.params, ['52998224725', 999]);
});

test('webhook PIX: CPF mascarado pelo MP e gravado mascarado', async () => {
  const { db, mod } = webhook({ mp: mpAprovado({ payer: { email: 'x@y.com', identification: { number: '***.982.247-**' } } }) });
  const un = silencia(); try { await rodar(mod); } finally { un(); }
  assert.deepStrictEqual(gravouPagador(db).params, ['***982247**', 999]);
});

test('webhook PIX: MP sem CPF do pagador => nada gravado (desconhecido = conta como antes)', async () => {
  const { db, mod } = webhook({ mp: mpAprovado() });
  const un = silencia(); try { await rodar(mod); } finally { un(); }
  assert.ok(!gravouPagador(db));
});

test('webhook PIX: pagador diferente do CPF do cadastro => grava e avisa no log (sem expor CPF)', async () => {
  const { db, mod } = webhook({ mp: mpAprovado({ point_of_interaction: { transaction_data: { bank_info: { payer: { identification: { number: '11122233344' } } } } } }) });
  const avisos = [];
  const l = console.log, w = console.warn, e = console.error;
  console.log = console.error = () => {}; console.warn = (...a) => avisos.push(a.join(' '));
  try { await rodar(mod); } finally { console.log = l; console.warn = w; console.error = e; }
  assert.ok(gravouPagador(db));
  const aviso = avisos.find((a) => /pagador diferente do CPF do cadastro/.test(a));
  assert.ok(aviso);
  assert.ok(!aviso.includes('11122233344') && !aviso.includes(CPF));
});

test('webhook PIX: falha ao gravar o pagador nao derruba o webhook', async () => {
  const { db, mod } = webhook({ mp: mpAprovado({ payer: { email: 'x@y.com', identification: { number: '52998224725' } } }) });
  const orig = db.query;
  db.query = async (sql, p) => { if (/SET pagador_cpf/.test(sql)) throw new Error('coluna inexistente'); return orig(sql, p); };
  db.execute = db.query;
  const un = silencia(); let res; try { res = await rodar(mod); } finally { un(); }
  assert.strictEqual(res.codigo, 200);
});
