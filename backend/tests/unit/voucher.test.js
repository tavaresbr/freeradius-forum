// Vouchers: utilitarios, admin (isolamento por empresa) e resgate no portal.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const u = require('../../src/utils/voucher');

const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

test('voucher utils: codigo de 8 chars sem simbolos ambiguos e normalizacao', () => {
  for (let i = 0; i < 200; i++) assert.match(u.gerarCodigo(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.strictEqual(u.normalizarCodigo(' ab-cd 23 '), 'ABCD23');
  assert.strictEqual(u.normalizarCodigo({ $ne: 1 }), '');
  assert.ok(u.codigoPersonalizadoValido('EVENTO2026'));
  assert.ok(!u.codigoPersonalizadoValido('ab'));
  assert.strictEqual(u.quantidadeValida(501), null);
  assert.strictEqual(u.quantidadeValida('10'), 10);
  assert.strictEqual(u.validarValidade('2020-01-01'), undefined);
  assert.strictEqual(u.validarValidade('2999-02-30'), undefined);
  assert.strictEqual(u.validarValidade(''), null);
  assert.strictEqual(u.celulaCsv('=1+1'), "'=1+1");
});

function ctrlAdmin(handler) {
  const db = criarDb(handler);
  return { c: carregar('src/controllers/voucherController.js', { db, extras: { 'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({}) }, 'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async () => ({}) } } }), db };
}

test('vouchers admin: lote valida plano da empresa, grava com empresa_id e N codigos unicos', async () => {
  const { c, db } = ctrlAdmin(async (sql, p) => {
    if (/FROM planos WHERE id/.test(sql)) return [p[1] === 7 ? [{ id: 5 }] : []];
    if (/FROM mikrotiks WHERE id = \? AND empresa_id/.test(sql)) return [p[1] === 7 && p[0] === '3' ? [{ id: 3 }] : []];
    return undefined;
  });
  let res = criarRes();
  await c.criarLote(criarReq({ empresa_id: 7, body: { plano_id: 5, mikrotik_id: 3, quantidade: 10 } }), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(new Set(res.body.codigos).size, 10);
  const ins = db.calls.filter((x) => /INSERT INTO vouchers/.test(x.sql));
  assert.strictEqual(ins.length, 10);
  assert.ok(ins.every((x) => x.params[0] === 7 && x.params[3] === 3)); // grava o equipamento
  res = criarRes();
  await c.criarLote(criarReq({ empresa_id: 8, body: { plano_id: 5, mikrotik_id: 3, quantidade: 1 } }), res);
  assert.strictEqual(res.statusCode, 400); // plano de outra empresa
  res = criarRes();
  await c.criarLote(criarReq({ empresa_id: 7, body: { plano_id: 5, mikrotik_id: 3, quantidade: 9999 } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.criarLote(criarReq({ empresa_id: 7, body: { plano_id: 5, quantidade: 1 } }), res);
  assert.strictEqual(res.statusCode, 400); // sem equipamento
  assert.match(res.body.error, /equipamento/i);
  res = criarRes();
  await c.criarLote(criarReq({ empresa_id: 7, body: { plano_id: 5, mikrotik_id: 99, quantidade: 1 } }), res);
  assert.strictEqual(res.statusCode, 400); // equipamento de outra empresa
});

test('vouchers admin: cancelar/excluir sempre escopados por empresa e status', async () => {
  const { c, db } = ctrlAdmin(async () => [{ affectedRows: 0 }]);
  let res = criarRes();
  await c.cancelar(criarReq({ empresa_id: 7, params: { id: '3' } }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.match(db.calls[0].sql, /empresa_id = \? AND status = 'disponivel'/);
  res = criarRes();
  await c.excluir(criarReq({ empresa_id: 7, params: { id: '3' } }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.match(db.calls[1].sql, /empresa_id = \? AND status <> 'usado'/);
});

function ctrlResgate({ voucher, plano = { id: 2, duracao_minutos: 60, velocidade_down: 20, velocidade_up: 10 }, claim = 1, saldo } = {}) {
  const db = criarDb(async (sql) => {
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ id: 3, empresa_id: 7, ip: '10.0.0.1', end_hotspot: 'hs.local' }]];
    if (/FROM vouchers v WHERE/.test(sql)) return [voucher ? [voucher] : []];
    if (/FROM planos WHERE id/.test(sql)) return [plano ? [plano] : []];
    if (/UPDATE vouchers SET status = 'usado'/.test(sql)) return [{ affectedRows: claim }];
    return undefined;
  });
  const c = carregar('src/controllers/voucherController.js', {
    db,
    extras: {
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async () => ({}) },
      'src/utils/leadUtils.js': { verificarSaldoRadius: async () => saldo || { existe: false, temSaldo: false } },
    },
  });
  return { c, db };
}
const resgatar = async (c, body) => {
  const res = criarRes(); const un = silencia();
  try { await c.resgatar(criarReq({ body: { codigo: 'abcd-2345', mikrotik_id: 3, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.9', ...body } }), res); } finally { un(); }
  return res;
};

test('resgate: voucher disponivel libera RADIUS com liberado_em no INSERT e todos os atributos', async () => {
  const { c, db } = ctrlResgate({ voucher: { id: 1, status: 'disponivel', expirado: 0, plano_id: 2 } });
  const res = await resgatar(c, {});
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.username, 'voucher_abcd2345');
  assert.ok(res.body.password);
  assert.strictEqual(res.body.gateway, 'hs.local');
  const sqls = db.calls.map((x) => x.sql).join('\n');
  assert.match(sqls, /Max-All-Session/);
  assert.match(sqls, /Simultaneous-Use/);
  assert.match(sqls, /WISPr-Bandwidth-Max-Down/);
  assert.match(sqls, /Mikrotik-Rate-Limit/);
  assert.match(sqls, /INSERT INTO radius_users \(empresa_id, username, plano_id, nas_id, liberado_em\)\s+VALUES \(\?, \?, \?, \?, NOW\(\)\)/);
  assert.match(sqls, /INSERT INTO radusergroup/);
});

test('resgate: inexistente, cancelado, expirado e corrida perdida => mesma resposta 403', async () => {
  const msgs = new Set();
  for (const cfg of [
    { voucher: null },
    { voucher: { id: 1, status: 'cancelado', plano_id: 2 } },
    { voucher: { id: 1, status: 'disponivel', expirado: 1, plano_id: 2 } },
    { voucher: { id: 1, status: 'disponivel', expirado: 0, plano_id: 2 }, claim: 0 },
  ]) {
    const { c } = ctrlResgate(cfg);
    const res = await resgatar(c, {});
    assert.strictEqual(res.statusCode, 403);
    msgs.add(res.body.error);
  }
  assert.strictEqual(msgs.size, 1);
});

test('resgate: voucher usado so reconecta no mesmo MAC e com saldo (sem renovar franquia)', async () => {
  const usado = { id: 1, status: 'usado', usado_mac: 'AA:BB:CC:DD:EE:01', username: 'voucher_abcd2345', plano_id: 2 };
  const saldo = { existe: true, temSaldo: true, password: 'segredo1', tempoRestante: 1200 };
  let r = await resgatar(ctrlResgate({ voucher: usado, saldo }).c, {});
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.password, 'segredo1');
  const { c, db } = ctrlResgate({ voucher: usado, saldo });
  await resgatar(c, {});
  assert.ok(!db.calls.some((x) => /INSERT INTO radcheck|liberado_em/.test(x.sql)));
  r = await resgatar(ctrlResgate({ voucher: usado, saldo }).c, { mac: 'AA:BB:CC:DD:EE:99' });
  assert.strictEqual(r.statusCode, 403);
  r = await resgatar(ctrlResgate({ voucher: usado, saldo: { existe: true, temSaldo: false } }).c, {});
  assert.strictEqual(r.statusCode, 403);
});

test('resgate: codigo nao-string (NoSQL/objeto) e rejeitado sem tocar o banco', async () => {
  const { c, db } = ctrlResgate({});
  const res = await resgatar(c, { codigo: { $ne: 1 } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(db.calls.length, 0);
});

test('vouchers admin: listar e CSV trazem plano e equipamento, com JOINs escopados por empresa', async () => {
  const { c, db } = ctrlAdmin(async (sql) => {
    if (/FROM vouchers v\s+LEFT JOIN planos/.test(sql) && /v\.codigo, p\.nome AS plano/.test(sql)) {
      return [[{ codigo: 'ABCD2345', plano: 'Plano 60', equipamento: 'Matriz', lote: null, status: 'usado', valido_ate: null, usado_em: null, usado_equipamento: 'Filial' }]];
    }
    if (/SELECT v\.id/.test(sql)) return [[{ id: 1, codigo: 'ABCD2345', plano_nome: 'Plano 60', equipamento_nome: 'Matriz', usado_equipamento: 'Filial' }]];
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 1 }]];
    return [[]];
  });
  let res = criarRes();
  await c.listar(criarReq({ empresa_id: 7, query: {} }), res);
  assert.strictEqual(res.body.data[0].equipamento_nome, 'Matriz');
  const q = db.calls.find((x) => /SELECT v\.id/.test(x.sql)).sql;
  assert.match(q, /m\.empresa_id = v\.empresa_id/);
  assert.match(q, /mu\.empresa_id = v\.empresa_id/);
  res = criarRes();
  await c.exportarCSV(criarReq({ empresa_id: 7, query: {} }), res);
  assert.match(String(res.body), /Codigo;Plano;Equipamento;Lote;Status;Valido ate;Usado em;Usado no equipamento/);
  assert.match(String(res.body), /ABCD2345;Plano 60;Matriz;.*;Filial/);
});

test('resgate: voucher exclusivo do equipamento so vale nele; legado (sem equipamento) vale em qualquer', async () => {
  const base = { id: 1, status: 'disponivel', expirado: 0, plano_id: 2 };
  let r = await resgatar(ctrlResgate({ voucher: { ...base, mikrotik_id: 9 } }).c, {}); // requisicao vem do equipamento 3
  assert.strictEqual(r.statusCode, 403);
  const { c, db } = ctrlResgate({ voucher: { ...base, mikrotik_id: 9 } });
  await resgatar(c, {});
  assert.ok(!db.calls.some((x) => /UPDATE vouchers SET status = 'usado'|INSERT INTO radcheck/.test(x.sql))); // nem reivindica
  r = await resgatar(ctrlResgate({ voucher: { ...base, mikrotik_id: 3 } }).c, {});
  assert.strictEqual(r.statusCode, 200);
  r = await resgatar(ctrlResgate({ voucher: { ...base, mikrotik_id: null } }).c, {});
  assert.strictEqual(r.statusCode, 200);
  const usado = { id: 1, status: 'usado', usado_mac: 'AA:BB:CC:DD:EE:01', username: 'voucher_x', plano_id: 2, mikrotik_id: 9 };
  r = await resgatar(ctrlResgate({ voucher: usado, saldo: { existe: true, temSaldo: true, password: 'p', tempoRestante: 10 } }).c, {});
  assert.strictEqual(r.statusCode, 403); // reconexao tambem respeita o equipamento
});

test('vouchers admin: marcarImpressos so toca DISPONIVEIS da propria empresa e valida ids', async () => {
  const { c, db } = ctrlAdmin(async () => [{ affectedRows: 2 }]);
  let res = criarRes();
  await c.marcarImpressos(criarReq({ empresa_id: 7, body: { ids: [1, '2', 2] } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.afetados, 2);
  const up = db.calls[0];
  assert.match(up.sql, /UPDATE vouchers SET impresso_em = NOW\(\) WHERE empresa_id = \? AND status = 'disponivel' AND id IN \(\?,\?\)/);
  assert.deepStrictEqual(up.params, [7, 1, 2]); // empresa primeiro, ids unicos
  for (const ids of [undefined, [], ['x'], [1.5], [-1], [{ $ne: 1 }], Array.from({ length: 1001 }, (_, i) => i + 1)]) {
    res = criarRes();
    await c.marcarImpressos(criarReq({ empresa_id: 7, body: { ids } }), res);
    assert.strictEqual(res.statusCode, 400);
  }
  assert.strictEqual(db.calls.length, 1); // os invalidos nao tocaram o banco
});

test('vouchers admin: listar filtra por impresso e ordena asc so quando pedido; devolve nao_impressos', async () => {
  const { c, db } = ctrlAdmin(async (sql) => {
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 0 }]];
    if (/impresso_em IS NULL", \[|status = 'disponivel' AND impresso_em IS NULL/.test(sql)) return [[{ n: 5 }]];
    return [[]];
  });
  let res = criarRes();
  await c.listar(criarReq({ empresa_id: 7, query: { impresso: 'nao', ordem: 'asc' } }), res);
  const q = db.calls.find((x) => /SELECT v\.id/.test(x.sql)).sql;
  assert.match(q, /v\.impresso_em IS NULL/);
  assert.match(q, /ORDER BY v\.id ASC/);
  assert.strictEqual(res.body.contadores.nao_impressos, 5);
  res = criarRes();
  await c.listar(criarReq({ empresa_id: 7, query: { ordem: 'DROP TABLE' } }), res);
  assert.match(db.calls.filter((x) => /SELECT v\.id/.test(x.sql)).pop().sql, /ORDER BY v\.id DESC/); // so 'asc' vale
});

test('vouchers admin: acaoEmMassa exclui so nao usados e cancela so disponiveis, da propria empresa, validando ids', async () => {
  const { c, db } = ctrlAdmin(async () => [{ affectedRows: 2 }]);
  let res = criarRes();
  await c.acaoEmMassa(criarReq({ empresa_id: 7, body: { acao: 'excluir', ids: [1, '2', 2, 3] } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([res.body.afetados, res.body.ignorados], [2, 1]); // 3 ids unicos, 2 afetados
  assert.match(db.calls[0].sql, /DELETE FROM vouchers WHERE empresa_id = \? AND status <> 'usado' AND id IN \(\?,\?,\?\)/);
  assert.deepStrictEqual(db.calls[0].params, [7, 1, 2, 3]);
  res = criarRes();
  await c.acaoEmMassa(criarReq({ empresa_id: 7, body: { acao: 'cancelar', ids: [5] } }), res);
  assert.match(db.calls[1].sql, /UPDATE vouchers SET status = 'cancelado' WHERE empresa_id = \? AND status = 'disponivel' AND id IN/);
  for (const body of [{ acao: 'apagar', ids: [1] }, { ids: [1] }, { acao: 'excluir' }, { acao: 'excluir', ids: [] }, { acao: 'excluir', ids: ['x'] },
    { acao: 'excluir', ids: [{ $ne: 1 }] }, { acao: 'excluir', ids: Array.from({ length: 1001 }, (_, i) => i + 1) }]) {
    res = criarRes();
    await c.acaoEmMassa(criarReq({ empresa_id: 7, body }), res);
    assert.strictEqual(res.statusCode, 400);
  }
  assert.strictEqual(db.calls.length, 2); // os invalidos nao tocaram o banco
});

test('vouchers admin: excluirPorFiltro - previa nao apaga, exige EXCLUIR, sempre empresa e status <> usado, em lotes de 5000', async () => {
  const { c, db } = ctrlAdmin(async (sql) => {
    if (/SELECT COUNT\(\*\) AS n FROM vouchers v WHERE/.test(sql)) return [[{ n: 12 }]];
    if (/^DELETE/.test(sql)) return [{ affectedRows: 7 }];
    return undefined;
  });
  let res = criarRes();
  await c.excluirPorFiltro(criarReq({ empresa_id: 7, body: { filtros: { lote: 'L1', equipamento: '3' }, previa: true } }), res);
  assert.strictEqual(res.body.alvo, 12);
  assert.ok(!db.calls.some((x) => /^DELETE/.test(x.sql)));
  const q = db.calls[0];
  assert.match(q.sql, /v\.empresa_id = \? AND v\.mikrotik_id = \? AND v\.lote = \? AND v\.status <> 'usado'/);
  assert.deepStrictEqual(q.params, [7, 3, 'L1']);
  res = criarRes();
  await c.excluirPorFiltro(criarReq({ empresa_id: 7, body: { filtros: {}, confirmar: 'excluir' } }), res); // minusculo nao vale
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!db.calls.some((x) => /^DELETE/.test(x.sql)));
  res = criarRes();
  await c.excluirPorFiltro(criarReq({ empresa_id: 7, body: { filtros: { lote: '__sem__', status: 'usado' }, confirmar: 'EXCLUIR' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual([res.body.afetados, res.body.restantes], [7, 12]);
  const del = db.calls.find((x) => /^DELETE/.test(x.sql));
  assert.match(del.sql, /DELETE FROM vouchers WHERE empresa_id = \? AND id IN \(SELECT id FROM \(SELECT v\.id FROM vouchers v WHERE .*v\.status <> 'usado' ORDER BY v\.id LIMIT 5000\) AS alvo\)/);
  assert.match(del.sql, /v\.lote IS NULL/);
  assert.strictEqual(del.params[0], 7);
  for (const filtros of ['x', [1], null]) {
    res = criarRes();
    await c.excluirPorFiltro(criarReq({ empresa_id: 7, body: { filtros: filtros === null ? null : filtros, previa: true } }), res);
    if (filtros !== null) assert.strictEqual(res.statusCode, 400);
  }
});
