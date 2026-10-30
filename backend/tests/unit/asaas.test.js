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

// ---------- cartao ----------
function montarCartao({ cartaoLigado = true, resposta = { id: 'pay_card1', status: 'CONFIRMED' }, erro = null, lead = { id: 1, nome: 'Ana', email: 'ana@x.com', cpf: '529.982.247-25', telefone: '(11) 98888-7777' } } = {}) {
  const estado = { criou: [], confirmou: [] };
  const db = criarDb(async (sql) => {
    if (/FROM planos WHERE id/.test(sql)) return [[{ id: 9, empresa_id: 3, nome: 'Plano 1h', valor: 500, duracao_minutos: 60, mikrotik_id: 2 }]];
    if (/FROM leads WHERE id/.test(sql)) return [[lead]];
    if (/INSERT INTO pagamentos/.test(sql)) return [{ insertId: 7 }];
    if (/FROM mikrotiks m WHERE/.test(sql)) return [[{ end_hotspot: 'hs.local', ip: '10.0.0.1' }]];
    return undefined;
  });
  limpar();
  const mod = carregar('src/controllers/pagamentoController.js', {
    db,
    extras: {
      'src/utils/asaasClient.js': {
        carregarConfig: async () => ({ api_key: 'k', cartao: cartaoLigado ? '1' : '0' }),
        cartaoAtivo: (c) => !!(c && c.api_key && c.cartao === '1'),
        pixAtivo: () => false,
        STATUS_PAGO: ['CONFIRMED', 'RECEIVED'],
        hojeBrasilia: () => '2026-10-30',
        obterOuCriarCliente: async () => 'cus_1',
        criarCobrancaCartao: async (cfg, args) => { estado.criou.push(args); if (erro) throw erro; return resposta; },
      },
      'src/services/asaasPagamento.js': {
        confirmarPagamentoAsaas: async () => 'approved',
        confirmarComCredencial: async (id) => { estado.confirmou.push(id); return { resultado: 'approved', cred: { username: '52998224725', password: 'senhaReal9' } }; },
      },
      'src/controllers/mikrotikAPIController.js': { liberarUsuario: async () => ({}) },
      'src/utils/radiusPassword.js': { obterSenhaRadius: async () => null },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async () => ({}) },
      'src/utils/leadUtils.js': { bloqueiaPagamentoAlheio: async () => false, MSG_PAGAMENTO_ALHEIO: 'x' },
    },
  });
  return { mod, db, estado };
}
const CARTAO = { card_number: '4111 1111 1111 1111', cardholder_name: 'ANA', expiration_month: '12', expiration_year: '30', security_code: '123',
  identification_number: '52998224725', plano_id: 9, mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', cliente_id: 1, cep: '01310-100', numero_endereco: '100' };
const pagarCartao = async (mod, body = CARTAO) => { const res = criarRes(); const un = silencia(); try { await mod.gerarPagamentoCartao(criarReq({ body, ip: '200.1.2.3' }), res); } finally { un(); } return res; };

test('cartao asaas: aprovado => libera pelo servico, devolve credenciais e manda os dados certos ao Asaas', async () => {
  const { mod, estado, db } = montarCartao();
  const res = await pagarCartao(mod);
  assert.strictEqual(res.body.status, 'approved');
  assert.strictEqual(res.body.password, 'senhaReal9');
  assert.deepStrictEqual(estado.confirmou, [7]);
  const a = estado.criou[0];
  assert.strictEqual(a.valor, 5);
  assert.strictEqual(a.referencia, 'pag_7_emp_3');
  assert.strictEqual(a.ipCliente, '200.1.2.3');
  assert.strictEqual(a.cartao.numero, '4111111111111111');
  assert.strictEqual(a.cartao.ano, '2030');
  assert.deepStrictEqual([a.titular.cep, a.titular.numeroEndereco, a.titular.telefone], ['01310100', '100', '11988887777']);
  assert.ok(db.calls.some((c) => /gateway = 'asaas'/.test(c.sql)));
  assert.ok(!JSON.stringify(db.calls).includes('4111'), 'numero do cartao nunca vai ao banco');
});

test('cartao asaas: em analise => pending (o portal acompanha por /status) sem liberar', async () => {
  const { mod, estado } = montarCartao({ resposta: { id: 'pay_card1', status: 'PENDING' } });
  const res = await pagarCartao(mod);
  assert.strictEqual(res.body.status, 'pending');
  assert.strictEqual(res.body.mp_pagamento_id, 'pay_card1');
  assert.deepStrictEqual(estado.confirmou, []);
});

test('cartao asaas: recusa do Asaas (400) => rejected com a mensagem e pagamento marcado rejected', async () => {
  const erro = Object.assign(new Error('Transacao nao autorizada'), { name: 'AsaasError', status: 400 });
  const { mod, db } = montarCartao({ erro });
  const res = await pagarCartao(mod);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.message, 'Transacao nao autorizada');
  assert.ok(db.calls.some((c) => /SET status = 'rejected'/.test(c.sql)));
});

test('cartao asaas: falha de rede/Asaas fora => 502 generico', async () => {
  const { mod } = montarCartao({ erro: Object.assign(new Error('timeout'), { name: 'AsaasError', status: null }) });
  const res = await pagarCartao(mod);
  assert.strictEqual(res.statusCode, 502);
});

test('cartao asaas: sem CEP/numero, sem telefone ou sem e-mail do cadastro => 400 antes de cobrar', async () => {
  for (const [body, lead] of [[{ ...CARTAO, cep: '123' }], [{ ...CARTAO, numero_endereco: '' }],
    [CARTAO, { id: 1, nome: 'Ana', email: 'ana@x.com', cpf: '529.982.247-25', telefone: null }],
    [CARTAO, { id: 1, nome: 'Ana', email: null, cpf: '529.982.247-25', telefone: '11988887777' }]]) {
    const { mod, estado } = montarCartao(lead ? { lead } : {});
    const res = await pagarCartao(mod, body);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(estado.criou, []);
  }
});

// ---------- diagnostico da migration 068 ----------
test('erroEnumAsaas: reconhece o erro do MySQL do ENUM sem asaas (e so ele)', () => {
  limpar();
  const { erroEnumAsaas } = carregar('src/utils/asaasClient.js', { db: criarDb() });
  assert.strictEqual(erroEnumAsaas({ errno: 1265, sqlMessage: "Data truncated for column 'config_type' at row 1" }), true);
  assert.strictEqual(erroEnumAsaas({ code: 'WARN_DATA_TRUNCATED' }), true);
  assert.strictEqual(erroEnumAsaas({ sqlMessage: "Incorrect enum value 'asaas' for column config_type" }), true);
  assert.strictEqual(erroEnumAsaas(new Error('ECONNREFUSED')), false);
  assert.strictEqual(erroEnumAsaas(null), false);
});

test('salvar config asaas com ENUM sem o valor => 503 com a instrucao da migration 068', async () => {
  const db = criarDb(async (sql) => {
    if (/^SELECT config_json/.test(sql)) return [[undefined]];
    if (/INSERT INTO empresa_configs/.test(sql)) throw Object.assign(new Error('x'), { errno: 1265, sqlMessage: "Data truncated for column 'config_type' at row 1" });
    return undefined;
  });
  limpar();
  const mod = carregar('src/controllers/empresaConfigController.js', { db });
  const res = criarRes(); const un = silencia();
  try { await mod.salvarConfig(criarReq({ params: { tipo: 'asaas' }, empresa_id: 3, user: { role: 'owner' }, body: { api_key: 'k', ambiente: 'sandbox', ativo: '1' } }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.message, /068_empresa_configs_asaas/);
});
