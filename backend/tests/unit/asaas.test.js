// Asaas (PIX): confirmacao pela API (nunca pelo corpo do webhook), referencia/valor, idempotencia e webhook.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };

const PAG = { id: 7, empresa_id: 3, plano_id: 9, status: 'aguardando', valor: 500, mp_pagamento_id: 'pay_abc', gateway: 'asaas',
  mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', nome_plano: 'Plano 1h', cpf: '52998224725', cliente_id: 1, portal_id: 2, telefone: null };
const PAGO = { status: 'RECEIVED', externalReference: 'pag_7_emp_3', value: 5 };

function montarServico({ cobranca = PAGO, pag = PAG, marcador = 1 } = {}) {
  const estado = { liberou: 0, usoCupom: 0 };
  const db = criarDb(async (sql) => {
    if (/FROM pagamentos WHERE id = \?/.test(sql)) return [[pag]];
    if (/FROM planos/.test(sql)) return [[{ duracao_minutos: 60 }]];
    if (/SET liberado_em = NOW\(\)/.test(sql)) return [{ affectedRows: marcador }];
    return undefined;
  });
  limpar();
  const mod = carregar('src/services/asaasPagamento.js', {
    db,
    extras: {
      'src/utils/asaasClient.js': { carregarConfig: async () => ({ api_key: 'k' }), obterCobranca: async () => cobranca, STATUS_PAGO: ['CONFIRMED', 'RECEIVED'] },
      'src/controllers/mikrotikAPIController.js': { liberarUsuario: async () => { estado.liberou++; return {}; } },
      'src/utils/cupons.js': { registrarUsoCupom: async () => { estado.usoCupom++; } },
    },
  });
  return { mod, db, estado };
}
const aprovou = (db) => db.calls.some((c) => /SET status = 'approved'/.test(c.sql));
const rodar = async (fn) => { const un = silencia(); try { return await fn(); } finally { un(); } };

test('asaas: cobranca paga, referencia e valor certos => aprova, marca pagador desconhecido e libera uma vez', async () => {
  const { mod, db, estado } = montarServico();
  assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'approved');
  assert.ok(aprovou(db));
  const upd = db.calls.find((c) => /SET status = 'approved'/.test(c.sql));
  assert.ok(upd.params.includes('DESCONHECIDO'), 'Asaas nao diz quem pagou: nao confirma o CPF');
  assert.strictEqual(estado.liberou, 1);
  assert.strictEqual(estado.usoCupom, 1);
});

test('asaas: cobranca ainda nao paga => pending, nada gravado nem liberado', async () => {
  const { mod, db, estado } = montarServico({ cobranca: { ...PAGO, status: 'PENDING' } });
  assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'pending');
  assert.ok(!aprovou(db));
  assert.strictEqual(estado.liberou, 0);
});

test('asaas: baixa manual (RECEIVED_IN_CASH) nao libera acesso', async () => {
  const { mod, estado } = montarServico({ cobranca: { ...PAGO, status: 'RECEIVED_IN_CASH' } });
  assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'pending');
  assert.strictEqual(estado.liberou, 0);
});

test('asaas: externalReference de outro pagamento ou valor menor => ignora', async () => {
  for (const cobranca of [{ ...PAGO, externalReference: 'pag_8_emp_3' }, { ...PAGO, externalReference: 'pag_7_emp_4' }, { ...PAGO, value: 1 }]) {
    const { mod, db, estado } = montarServico({ cobranca });
    assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'ignorado');
    assert.ok(!aprovou(db));
    assert.strictEqual(estado.liberou, 0);
  }
});

test('asaas: pagamento que nao e do Asaas (MP) nunca e tocado', async () => {
  const { mod, db } = montarServico({ pag: { ...PAG, gateway: null } });
  assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'ignorado');
  assert.ok(!aprovou(db));
});

test('asaas: ja liberado por outro caminho (marcador) => nao libera de novo', async () => {
  const { mod, estado } = montarServico({ pag: { ...PAG, status: 'approved' }, marcador: 0 });
  assert.strictEqual(await rodar(() => mod.confirmarPagamentoAsaas(7)), 'approved');
  assert.strictEqual(estado.liberou, 0);
});

// ---------- webhook ----------
const TOKEN = 'a'.repeat(48);
function montarWebhook({ dono = { empresaId: 3 }, pagId = 7 } = {}) {
  const estado = { confirmou: [] };
  const db = criarDb(async (sql) => (/FROM pagamentos WHERE mp_pagamento_id/.test(sql) ? [[pagId ? { id: pagId } : undefined]] : undefined));
  limpar();
  const mod = carregar('src/controllers/asaasController.js', {
    db,
    extras: {
      'src/utils/asaasClient.js': { empresaPorWebhookToken: async (t) => (t === TOKEN ? dono : null) },
      'src/services/asaasPagamento.js': { confirmarPagamentoAsaas: async (id) => { estado.confirmou.push(id); return 'approved'; } },
    },
  });
  return { mod, estado };
}
const chamarWebhook = async (mod, req) => { const res = criarRes(); res.sendStatus = (c) => { res.statusCode = c; return res; }; const un = silencia(); try { await mod.webhook(req, res); } finally { un(); } return res; };
const corpo = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_abc' } };

test('webhook asaas: token desconhecido => 404 sem consultar nada', async () => {
  const { mod, estado } = montarWebhook();
  assert.strictEqual((await chamarWebhook(mod, criarReq({ params: { token: 'x' }, body: corpo }))).statusCode, 404);
  assert.deepStrictEqual(estado.confirmou, []);
});

test('webhook asaas: cabecalho asaas-access-token diferente => 401', async () => {
  const { mod, estado } = montarWebhook();
  const r = await chamarWebhook(mod, criarReq({ params: { token: TOKEN }, headers: { 'asaas-access-token': 'outro' }, body: corpo }));
  assert.strictEqual(r.statusCode, 401);
  assert.deepStrictEqual(estado.confirmou, []);
});

test('webhook asaas: pagamento confirmado => confirma o registro interno; evento irrelevante => 200 sem confirmar', async () => {
  const { mod, estado } = montarWebhook();
  const ok = await chamarWebhook(mod, criarReq({ params: { token: TOKEN }, headers: { 'asaas-access-token': TOKEN }, body: corpo }));
  assert.strictEqual(ok.statusCode, 200);
  assert.deepStrictEqual(estado.confirmou, [7]);
  const outro = await chamarWebhook(mod, criarReq({ params: { token: TOKEN }, body: { event: 'PAYMENT_CREATED', payment: { id: 'pay_abc' } } }));
  assert.strictEqual(outro.statusCode, 200);
  assert.deepStrictEqual(estado.confirmou, [7]);
});

test('webhook asaas: cobranca que nao e da empresa do token => 200 e nada confirmado', async () => {
  const { mod, estado } = montarWebhook({ pagId: null });
  assert.strictEqual((await chamarWebhook(mod, criarReq({ params: { token: TOKEN }, body: corpo }))).statusCode, 200);
  assert.deepStrictEqual(estado.confirmou, []);
});
