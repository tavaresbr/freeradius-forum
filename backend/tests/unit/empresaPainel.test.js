const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const u = require('../../src/utils/empresaPainel');

test('clienteDesde: anos e meses de calendario, meses, dias e hoje', () => {
  const agora = new Date(2026, 9, 30, 12);
  assert.equal(u.clienteDesde(new Date(2024, 6, 15), agora).texto, '2 anos e 3 meses');
  assert.equal(u.clienteDesde(new Date(2025, 9, 30), agora).texto, '1 ano');
  assert.equal(u.clienteDesde(new Date(2026, 4, 31), agora).texto, '4 meses'); // 31/05 -> 30/10 ainda nao fechou o 5o mes
  assert.equal(u.clienteDesde(new Date(2026, 9, 18), agora).texto, '12 dias');
  assert.equal(u.clienteDesde(new Date(2026, 9, 30, 8), agora).texto, 'hoje');
  assert.equal(u.clienteDesde(null, agora).texto, 'hoje');
  assert.equal(u.clienteDesde(new Date(2027, 1, 1), agora).texto, 'hoje'); // data no futuro
});

test('validacoes: motivo, dias, nota e id', () => {
  assert.ok(u.validarMotivo('  ').erro);
  assert.ok(u.validarMotivo('ab').erro);
  assert.ok(u.validarMotivo('x'.repeat(201)).erro);
  assert.equal(u.validarMotivo('  cortesia   do   mês ').motivo, 'cortesia do mês');
  for (const v of [0, -1, 366, 1.5, 'abc', null]) assert.ok(u.validarDias(v).erro, String(v));
  assert.equal(u.validarDias('7').dias, 7);
  assert.ok(u.validarNota('').erro);
  assert.ok(u.validarNota('x'.repeat(1001)).erro);
  assert.equal(u.idValido('12'), 12);
  assert.equal(u.idValido('1; DROP'), null);
  assert.equal(u.idValido(0), null);
});

function criar({ assinatura, plano, planos = {}, aplicar } = {}) {
  const aplicadas = [];
  const db = criarDb((sql, params) => {
    if (/^SELECT \* FROM empresas WHERE id/i.test(sql)) return [params[0] === 99 ? [] : [{ id: params[0], nome: 'Emp', slug: 'emp', ativo: 1, criado_em: new Date(2024, 0, 1) }]];
    if (/FROM saas_planos WHERE id/i.test(sql)) return [planos[params[0]] ? [planos[params[0]]] : []];
    if (/FROM assinaturas a LEFT JOIN saas_planos p/i.test(sql)) return [assinatura ? [assinatura] : []];
  });
  const c = carregar('src/controllers/empresaPainelController.js', {
    db,
    extras: {
      'src/controllers/assinaturaController.js': { aplicarAssinatura: async (id, dados) => { aplicadas.push({ id, dados }); if (aplicar) await aplicar(); } },
      'src/utils/sessaoAdmin.js': { limparCacheSessaoAdmin() {}, adminAtivoNaEmpresa: async () => true },
    },
  });
  return { c, db, aplicadas };
}
const req = (id, body, extra = {}) => criarReq({ params: { id: String(id) }, body, user: { id: 7, empresa_id: 5 }, ...extra });
const historicos = (db) => db.calls.filter((x) => /INSERT INTO empresa_historico/i.test(x.sql));

test('gratificar: valida dias e motivo, recusa plano gratis, estende trial e grava historico', async () => {
  let { c, db, aplicadas } = criar({ assinatura: { status: 'ativa', gratis: 0 } });
  let res = criarRes();
  await c.gratificar(req(1, { dias: 0, motivo: 'cortesia' }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.gratificar(req(1, { dias: 7, motivo: '' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(aplicadas.length, 0);
  res = criarRes();
  await c.gratificar(req(1, { dias: 7, motivo: 'cortesia' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(aplicadas[0].dados, { estender_dias: 7 });
  assert.equal(historicos(db).length, 1);
  assert.match(historicos(db)[0].params[3], /\+7 dias/);

  ({ c, db, aplicadas } = criar({ assinatura: { status: 'trial', gratis: 0 } }));
  res = criarRes();
  await c.gratificar(req(1, { dias: 3, motivo: 'teste prolongado' }), res);
  assert.deepEqual(aplicadas[0].dados, { estender_dias: 3, status: 'trial' });

  ({ c, aplicadas } = criar({ assinatura: { status: 'ativa', gratis: 1 } }));
  res = criarRes();
  await c.gratificar(req(1, { dias: 3, motivo: 'cortesia' }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(aplicadas.length, 0);
});

test('plano gratis: so plano gratuito ativo; plano pago: recusa gratis', async () => {
  const planos = { 1: { id: 1, nome: 'Free', ativo: 1, gratis: 1 }, 2: { id: 2, nome: 'Pro', ativo: 1, gratis: 0 }, 3: { id: 3, nome: 'Velho', ativo: 0, gratis: 1 } };
  const { c, db, aplicadas } = criar({ planos });
  let res = criarRes();
  await c.planoGratis(req(1, { plano_id: 2, motivo: 'parceria' }), res);
  assert.equal(res.statusCode, 409);
  res = criarRes();
  await c.planoGratis(req(1, { plano_id: 3, motivo: 'parceria' }), res);
  assert.equal(res.statusCode, 409);
  res = criarRes();
  await c.planoGratis(req(1, { plano_id: 1, motivo: 'parceria' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(aplicadas[0].dados, { plano_id: 1, status: 'ativa' });
  assert.equal(historicos(db).length, 1);

  res = criarRes();
  await c.planoPago(req(1, { plano_id: 1, motivo: 'volta' }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.planoPago(req(1, { plano_id: 2, dias: 500, motivo: 'volta' }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.planoPago(req(1, { plano_id: 2, motivo: 'volta' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(aplicadas[1].dados.plano_id, 2);
  assert.equal(aplicadas[1].dados.status, 'ativa');
  assert.ok(aplicadas[1].dados.vence_em instanceof Date);
});

test('suspender: exige motivo, recusa a propria empresa e a da plataforma, reativar libera', async () => {
  const { c, db } = criar();
  let res = criarRes();
  await c.suspender(req(2, { motivo: '' }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.suspender(req(5, { motivo: 'inadimplente' }), res); // empresa do proprio usuario
  assert.equal(res.statusCode, 409);
  res = criarRes();
  await c.suspender(req(1, { motivo: 'inadimplente' }), res); // plataforma (SITE_EMPRESA_ID padrao 1)
  assert.equal(res.statusCode, 409);
  assert.equal(db.calls.filter((x) => /UPDATE empresas SET ativo/i.test(x.sql)).length, 0);
  res = criarRes();
  await c.suspender(req(2, { motivo: 'inadimplente' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.calls.find((x) => /UPDATE empresas SET ativo/i.test(x.sql)).params, [0, 2]);
  res = criarRes();
  await c.reativar(req(2, { motivo: 'pagou' }), res);
  assert.deepEqual(db.calls.filter((x) => /UPDATE empresas SET ativo/i.test(x.sql))[1].params, [1, 2]);
  assert.equal(historicos(db).length, 2);
});

test('empresa invalida ou inexistente: 400 e 404; falha ao gravar historico nao derruba a acao', async () => {
  const { c } = criar();
  let res = criarRes();
  await c.alterarPlano(req('abc', {}), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.alterarPlano(req(99, {}), res);
  assert.equal(res.statusCode, 404);

  const db = criarDb((sql, params) => {
    if (/INSERT INTO empresa_historico/i.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
    if (/^SELECT \* FROM empresas WHERE id/i.test(sql)) return [[{ id: 2, nome: 'E', slug: 'e', ativo: 1 }]];
    if (/FROM assinaturas a LEFT JOIN saas_planos p/i.test(sql)) return [[{ status: 'ativa', gratis: 0 }]];
  });
  const c2 = carregar('src/controllers/empresaPainelController.js', {
    db, extras: { 'src/controllers/assinaturaController.js': { aplicarAssinatura: async () => {} }, 'src/utils/sessaoAdmin.js': { limparCacheSessaoAdmin() {} } },
  });
  res = criarRes();
  await c2.gratificar(req(2, { dias: 5, motivo: 'cortesia' }), res);
  assert.equal(res.statusCode, 200);
});
