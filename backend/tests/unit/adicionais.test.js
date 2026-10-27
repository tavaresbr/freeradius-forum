const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado: respostas por trecho de SQL (a primeira que casar vence)
const chamadas = [];
let respostas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    const r = respostas.find((x) => x.re.test(sql));
    if (r && r.out instanceof Error) throw r.out;
    return r ? r.out : [[], []];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const ass = require('../../src/utils/assinatura');
const ctrl = require('../../src/controllers/assinaturaController');

const DIA = 86400000;
const emReal = (dias) => new Date(Date.now() + dias * DIA);
const resMock = () => {
  const r = { code: 200 };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.sendStatus = (c) => { r.code = c; };
  return r;
};

// Plano Start (ordem 2): 2 equipamentos, 1 admin
const PLANO_START = { plano_id: 2, status: 'ativa', vence_em: emReal(10), carencia_dias: 3, plano_nome: 'Start', plano_valor: 59.9, max_equipamentos: 2, max_admins: 1 };
const baseStatus = (extra = []) => [
  { re: /FROM assinaturas a LEFT JOIN saas_planos/, out: [[PLANO_START]] },
  ...extra,
];

test('limiteEfetivo: soma adicionais, ilimitado continua ilimitado', () => {
  assert.strictEqual(ass.limiteEfetivo(2, 5), 7);
  assert.strictEqual(ass.limiteEfetivo(2, 0), 2);
  assert.strictEqual(ass.limiteEfetivo(null, 5), null);
  assert.strictEqual(ass.limiteEfetivo(3, undefined), 3);
});

test('obterStatus: limite do plano + adicionais vigentes (quantidade x incremento)', async () => {
  ass.invalidar();
  respostas = baseStatus([
    { re: /FROM assinatura_adicionais aa/, out: [[
      { id: 1, adicional_id: 2, quantidade: 2, vence_em: emReal(5), nome: '+5 equipamentos', tipo: 'equipamentos', incremento: 5, valor: 119.9 },
      { id: 2, adicional_id: 3, quantidade: 1, vence_em: emReal(3), nome: '+1 administrador', tipo: 'admins', incremento: 1, valor: 14.9 },
    ]] },
  ]);
  const st = await ass.obterStatus(1);
  assert.strictEqual(st.max_equipamentos, 12); // 2 do plano + 2 x 5
  assert.strictEqual(st.max_admins, 2);
  assert.strictEqual(st.plano_max_equipamentos, 2);
  assert.strictEqual(st.adicionais.length, 2);
  assert.ok(st.adicionais[0].dias_restantes >= 4);
});

test('obterStatus: so conta adicional vigente (a consulta filtra vence_em) e plano ilimitado nao muda', async () => {
  ass.invalidar();
  respostas = [
    { re: /FROM assinaturas a LEFT JOIN saas_planos/, out: [[{ ...PLANO_START, max_equipamentos: null }]] },
    { re: /FROM assinatura_adicionais aa/, out: [[{ id: 1, adicional_id: 2, quantidade: 1, vence_em: emReal(5), nome: 'x', tipo: 'equipamentos', incremento: 5, valor: 1 }]] },
  ];
  const st = await ass.obterStatus(1);
  assert.strictEqual(st.max_equipamentos, null);
  assert.match(chamadas.find((c) => /FROM assinatura_adicionais aa/.test(c.sql)).sql, /vence_em >= NOW\(\)/);
});

test('obterStatus: sem a migration 041 (tabela inexistente) segue so com o plano', async () => {
  ass.invalidar();
  const erro = Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
  respostas = baseStatus([{ re: /FROM assinatura_adicionais aa/, out: erro }]);
  const st = await ass.obterStatus(1);
  assert.strictEqual(st.max_equipamentos, 2);
  assert.deepStrictEqual(st.adicionais, []);
});

test('checarLimite: com adicional vigente libera criar acima do limite do plano', async () => {
  ass.invalidar();
  respostas = baseStatus([
    { re: /FROM assinatura_adicionais aa/, out: [[{ id: 1, adicional_id: 1, quantidade: 1, vence_em: emReal(5), nome: '+1', tipo: 'equipamentos', incremento: 1, valor: 29.9 }]] },
    { re: /COUNT\(\*\) AS n FROM mikrotiks/, out: [[{ n: 2 }]] },
  ]);
  const lim = await ass.checarLimite(1, 'equipamentos');
  assert.strictEqual(lim.limite, 3);
  assert.strictEqual(lim.ok, true); // 2 usados < 3
  ass.invalidar();
  respostas = baseStatus([{ re: /COUNT\(\*\) AS n FROM mikrotiks/, out: [[{ n: 2 }]] }]);
  assert.strictEqual((await ass.checarLimite(1, 'equipamentos')).ok, false); // sem adicional: bloqueia
});

test('motivoIndisponivel: tipo sem efeito, plano abaixo do minimo, plano ilimitado, assinatura vencida', () => {
  const m = ctrl.motivoIndisponivel;
  const st = { status: 'ativa', plano_max_equipamentos: 2, plano_max_admins: 1 };
  const base = { tipo: 'equipamentos', plano_minimo_id: 2, plano_minimo_nome: 'Start' };
  assert.strictEqual(m(base, st, 2, 2), null);
  assert.match(m({ ...base, tipo: 'sem_marca' }, st, 2, 2), /ainda não disponível/);
  assert.match(m(base, st, 1, 2), /a partir do plano Start/);
  assert.match(m(base, st, null, 2), /a partir do plano Start/);
  assert.match(m(base, { ...st, plano_max_equipamentos: null }, 2, 2), /ilimitado/);
  assert.match(m(base, { ...st, status: 'vencida' }, 2, 2), /Renove o plano/);
  assert.strictEqual(m({ tipo: 'admins', plano_minimo_id: null }, st, 1, null), null);
});

const ADICIONAL_5EQ = { id: 2, nome: '+5 equipamentos', tipo: 'equipamentos', valor: 119.9, plano_minimo_id: 2, plano_minimo_nome: 'Start', plano_minimo_ordem: 2 };
const respItem = (extra = []) => [
  ...extra,
  { re: /FROM saas_adicionais a LEFT JOIN saas_planos pm/, out: [[ADICIONAL_5EQ]] },
  { re: /SELECT ordem FROM saas_planos/, out: [[{ ordem: 2 }]] },
  ...baseStatus(),
  { re: /FROM assinatura_adicionais aa/, out: [[]] },
];

test('resolverItem: adicional = valor do catalogo x quantidade (calculado no servidor)', async () => {
  ass.invalidar();
  respostas = respItem();
  const { item, erro } = await ctrl.resolverItem({ adicional_id: 2, quantidade: 3, valor: 0.01 }, 1);
  assert.strictEqual(erro, undefined);
  assert.strictEqual(item.valor, 359.7);
  assert.deepStrictEqual(item.cobranca, { adicional_id: 2, quantidade: 3, assinatura_adicional_id: null });
});

test('resolverItem: recusa quantidade invalida, plano abaixo do minimo e tipo inativo', async () => {
  ass.invalidar();
  respostas = respItem();
  assert.strictEqual((await ctrl.resolverItem({ adicional_id: 2, quantidade: 21 }, 1)).erro.status, 400);
  assert.strictEqual((await ctrl.resolverItem({ adicional_id: 2, quantidade: 0.4 }, 1)).erro.status, 400);

  ass.invalidar();
  respostas = [{ re: /SELECT ordem FROM saas_planos/, out: [[{ ordem: 1 }]] }, ...respItem()];
  const abaixo = await ctrl.resolverItem({ adicional_id: 2, quantidade: 1 }, 1);
  assert.strictEqual(abaixo.erro.status, 409);
  assert.match(abaixo.erro.message, /a partir do plano Start/);

  ass.invalidar();
  respostas = [{ re: /FROM saas_adicionais a LEFT JOIN saas_planos pm/, out: [[{ ...ADICIONAL_5EQ, tipo: 'sem_marca' }]] }, ...respItem()];
  assert.strictEqual((await ctrl.resolverItem({ adicional_id: 2, quantidade: 1 }, 1)).erro.status, 409);

  ass.invalidar();
  respostas = [{ re: /FROM saas_adicionais a LEFT JOIN saas_planos pm/, out: [[]] }, ...respItem()];
  assert.strictEqual((await ctrl.resolverItem({ adicional_id: 99 }, 1)).erro.status, 404);
});

test('resolverItem: renovacao usa a quantidade da compra e so da propria empresa', async () => {
  ass.invalidar();
  respostas = respItem([{ re: /FROM assinatura_adicionais WHERE id = \? AND empresa_id = \?/, out: [[{ id: 7, adicional_id: 2, quantidade: 2 }]] }]);
  const { item } = await ctrl.resolverItem({ renovar_adicional_id: 7, quantidade: 9 }, 1);
  assert.strictEqual(item.valor, 239.8);
  assert.strictEqual(item.cobranca.assinatura_adicional_id, 7);
  assert.strictEqual(item.cobranca.quantidade, 2);
  assert.deepStrictEqual(chamadas.find((c) => /WHERE id = \? AND empresa_id = \?/.test(c.sql)).params, [7, 1]);

  ass.invalidar();
  respostas = respItem([{ re: /FROM assinatura_adicionais WHERE id = \? AND empresa_id = \?/, out: [[]] }]);
  assert.strictEqual((await ctrl.resolverItem({ renovar_adicional_id: 8 }, 1)).erro.status, 404);
});

test('PIX de adicional: cobra valor x quantidade e grava adicional_id/quantidade (nao plano_id)', async () => {
  const axios = require('axios');
  const origPost = axios.post;
  let corpoMp = null;
  axios.post = async (url, body) => { corpoMp = body; return { data: { id: 99, point_of_interaction: { transaction_data: { qr_code: 'cc', qr_code_base64: 'bb' } } } }; };
  ass.invalidar();
  chamadas.length = 0;
  respostas = respItem([
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T' }) }]] },
    { re: /SELECT email FROM empresas/, out: [[{ email: 'a@b.com' }]] },
    { re: /INSERT INTO assinatura_cobrancas/, out: [{ insertId: 31 }] },
  ]);
  const res = resMock();
  await ctrl.criarCobranca({ body: { adicional_id: 2, quantidade: 2, valor: 1 }, empresa_id: 1, headers: { host: 'x.com' } }, res);
  axios.post = origPost;
  assert.strictEqual(res.code, 201);
  assert.strictEqual(res.body.valor, 239.8);
  assert.strictEqual(corpoMp.transaction_amount, 239.8);
  assert.match(corpoMp.description, /Adicional \+5 equipamentos x2/);
  assert.strictEqual(corpoMp.external_reference, 'ass_31_emp_1');
  const ins = chamadas.find((c) => /INSERT INTO assinatura_cobrancas/.test(c.sql));
  assert.match(ins.sql, /adicional_id, quantidade, assinatura_adicional_id/);
  assert.deepStrictEqual(ins.params, [1, 239.8, 'pix', 2, 2, null]);
});

test('webhook de adicional: so a primeira aprovacao cria a compra (idempotente)', async () => {
  const axios = require('axios');
  const origGet = axios.get;
  axios.get = async () => ({ data: { id: 77, status: 'approved', transaction_amount: 119.9, external_reference: 'ass_5_emp_3' } });
  const cobranca = { id: 5, empresa_id: 3, plano_id: null, adicional_id: 2, quantidade: 1, assinatura_adicional_id: null, valor: 119.9, status: 'aguardando', mp_pagamento_id: '77' };
  const base = [
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T', webhook_secret: '' }) }]] },
    { re: /SELECT \* FROM assinatura_cobrancas/, out: [[cobranca]] },
    { re: /SELECT ciclo_dias FROM saas_adicionais/, out: [[{ ciclo_dias: 30 }]] },
  ];
  let criadas = 0; let assinaturaMexida = false;
  for (const affected of [1, 0]) {
    chamadas.length = 0;
    respostas = [...base, { re: /UPDATE assinatura_cobrancas SET status = 'aprovada'/, out: [{ affectedRows: affected }] }];
    const res = resMock();
    await ctrl.webhook({ body: { data: { id: '77' } }, query: {}, headers: {} }, res);
    assert.strictEqual(res.code, 200);
    if (chamadas.some((c) => /INSERT INTO assinatura_adicionais/.test(c.sql))) criadas++;
    if (chamadas.some((c) => /INSERT INTO assinaturas /.test(c.sql))) assinaturaMexida = true;
  }
  axios.get = origGet;
  assert.strictEqual(criadas, 1);
  assert.strictEqual(assinaturaMexida, false); // adicional nao estende o plano
});

test('webhook de renovacao: estende o vence_em da MESMA compra (a partir do maior entre agora e o atual)', async () => {
  const axios = require('axios');
  const origGet = axios.get;
  axios.get = async () => ({ data: { id: 78, status: 'approved', transaction_amount: 119.9, external_reference: 'ass_6_emp_3' } });
  chamadas.length = 0;
  respostas = [
    { re: /FROM plataforma_configs/, out: [[{ config_json: JSON.stringify({ access_token: 'T' }) }]] },
    { re: /SELECT \* FROM assinatura_cobrancas/, out: [[{ id: 6, empresa_id: 3, plano_id: null, adicional_id: 2, quantidade: 1, assinatura_adicional_id: 7, valor: 119.9, status: 'aguardando', mp_pagamento_id: '78' }]] },
    { re: /SELECT ciclo_dias FROM saas_adicionais/, out: [[{ ciclo_dias: 30 }]] },
    { re: /UPDATE assinatura_cobrancas SET status = 'aprovada'/, out: [{ affectedRows: 1 }] },
  ];
  await ctrl.webhook({ body: { data: { id: '78' } }, query: {}, headers: {} }, resMock());
  axios.get = origGet;
  const up = chamadas.find((c) => /UPDATE assinatura_adicionais/.test(c.sql));
  assert.ok(up, 'deveria estender a compra existente');
  assert.match(up.sql, /GREATEST\(NOW\(\), vence_em\)/);
  assert.deepStrictEqual(up.params, [30, 7, 3]);
  assert.ok(!chamadas.some((c) => /INSERT INTO assinatura_adicionais/.test(c.sql)));
});

test('adicionaisEmpresa: lista o catalogo com disponivel/motivo e as compras', async () => {
  ass.invalidar();
  respostas = [
    { re: /FROM saas_adicionais a LEFT JOIN saas_planos pm/, out: [[
      { id: 1, nome: '+1 equipamento', descricao: null, tipo: 'equipamentos', incremento: 1, valor: '29.90', ciclo_dias: 30, plano_minimo_id: 2, plano_minimo_nome: 'Start', plano_minimo_ordem: 2 },
      { id: 8, nome: 'Dominio', descricao: null, tipo: 'sem_marca', incremento: 1, valor: '39.90', ciclo_dias: 30, plano_minimo_id: 4, plano_minimo_nome: 'Business', plano_minimo_ordem: 4 },
    ]] },
    { re: /SELECT ordem FROM saas_planos/, out: [[{ ordem: 2 }]] },
    ...baseStatus(),
    { re: /FROM assinatura_adicionais aa JOIN saas_adicionais a ON a.id = aa.adicional_id\s+WHERE aa.empresa_id = \? AND aa.vence_em >= DATE_SUB/, out: [[
      { id: 7, adicional_id: 1, quantidade: 1, vence_em: emReal(-2), nome: '+1 equipamento', tipo: 'equipamentos', valor: '29.90' },
    ]] },
    { re: /FROM assinatura_adicionais aa/, out: [[]] },
  ];
  const res = resMock();
  await ctrl.adicionaisEmpresa({ empresa_id: 1 }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.catalogo[0].disponivel, true);
  assert.strictEqual(res.body.catalogo[0].valor, 29.9);
  assert.strictEqual(res.body.catalogo[1].disponivel, false);
  assert.match(res.body.catalogo[1].motivo, /ainda não disponível/);
  assert.strictEqual(res.body.minhas[0].vigente, false); // vencida ha 2 dias: aparece para renovar
});

test('super admin: nao ativa tipo sem efeito, valida valor e plano minimo; remover com compra vigente = 409', async () => {
  respostas = [{ re: /SELECT id FROM saas_planos WHERE id/, out: [[]] }];
  let res = resMock();
  await ctrl.criarAdicional({ body: { nome: 'WA', tipo: 'sem_marca', valor: 49.9, ativo: true } }, res);
  assert.strictEqual(res.code, 400);
  assert.match(res.body.message, /ainda não pode ser ativado/);

  res = resMock();
  await ctrl.criarAdicional({ body: { nome: 'x', tipo: 'equipamentos', valor: -1 } }, res);
  assert.strictEqual(res.code, 400);

  res = resMock();
  await ctrl.criarAdicional({ body: { nome: 'x', tipo: 'equipamentos', valor: 10, plano_minimo_id: 99 } }, res);
  assert.strictEqual(res.code, 400);
  assert.match(res.body.message, /Plano mínimo/);

  // inativo de tipo sem efeito pode ser cadastrado
  chamadas.length = 0;
  respostas = [{ re: /INSERT INTO saas_adicionais/, out: [{ insertId: 12 }] }];
  res = resMock();
  await ctrl.criarAdicional({ body: { nome: 'WA', tipo: 'sem_marca', valor: 49.9, ativo: false } }, res);
  assert.strictEqual(res.code, 201);

  respostas = [{ re: /COUNT\(\*\) AS n FROM assinatura_adicionais WHERE adicional_id = \? AND vence_em >= NOW\(\)/, out: [[{ n: 2 }]] }];
  res = resMock();
  await ctrl.removerAdicional({ params: { id: 1 } }, res);
  assert.strictEqual(res.code, 409);

  // so historico: desativa em vez de apagar
  chamadas.length = 0;
  respostas = [
    { re: /vence_em >= NOW\(\)/, out: [[{ n: 0 }]] },
    { re: /COUNT\(\*\) AS n FROM assinatura_adicionais WHERE adicional_id/, out: [[{ n: 3 }]] },
  ];
  res = resMock();
  await ctrl.removerAdicional({ params: { id: 1 } }, res);
  assert.ok(chamadas.some((c) => /UPDATE saas_adicionais SET ativo = 0/.test(c.sql)));
  assert.ok(!chamadas.some((c) => /DELETE FROM saas_adicionais/.test(c.sql)));
});
