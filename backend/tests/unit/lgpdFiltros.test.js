// Filtros da tela Cadastros LGPD (e do CSV): sempre empresa_id do tenant, placeholders e validacao.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const silencia = () => { const l = console.error; console.error = () => {}; return () => { console.error = l; }; };
const ctrl = (db, temEq = true) => carregar('src/controllers/lgpdController.js', {
  db,
  extras: {
    'src/utils/leadUtils.js': {},
    'src/utils/schemaCache.js': { temColuna: async () => temEq },
    'src/utils/apInfo.js': { resolverApDoContexto: async () => ({}) },
    'src/services/whatsappNotify.js': { notificarLiberacao: async () => {}, normalizarTelefone: (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? `55${d}` : d.length >= 12 && d.length <= 13 ? d : null; } },
    'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({}) },
    'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async () => ({}) },
  },
});

test('sem filtro: so empresa_id do tenant', () => {
  const { montarFiltrosLgpd } = ctrl(criarDb());
  const f = montarFiltrosLgpd({}, 7);
  assert.deepStrictEqual(f.params, [7]);
  assert.ok(!/\bAND l\.(origem = \?|ssid|ap_mac)/.test(f.where));
});

test('cada filtro vira AND com placeholder e empresa_id nunca vem da query', () => {
  const { montarFiltrosLgpd } = ctrl(criarDb());
  const f = montarFiltrosLgpd({ empresa_id: '99', origem: 'portal_lead', aceite: '0', de: '2026-10-01', ate: '2026-10-31', ap: 'AA:BB:CC:DD:EE:FF', ssid: 'Wi-Fi Loja' }, 7);
  assert.strictEqual(f.params[0], 7);
  assert.deepStrictEqual(f.params.slice(1), ['portal_lead', 0, '2026-10-01 00:00:00', '2026-10-31 00:00:00', 'AA:BB:CC:DD:EE:FF', 'Wi-Fi Loja']);
  assert.match(f.where, /l\.origem = \?/);
  assert.match(f.where, /l\.lgpd_aceite = \?/);
  assert.match(f.where, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(f.where, /l\.ap_mac = \?/);
  assert.match(f.where, /l\.ssid = \?/);
  assert.ok(!f.where.includes('portal_lead'));
});

test('valores invalidos viram 400', () => {
  const { montarFiltrosLgpd } = ctrl(criarDb());
  const ruins = [
    { origem: "x' OR 1=1 --" }, { aceite: '2' }, { de: '2026-02-30' }, { de: 'ontem' },
    { de: '2026-10-10', ate: '2026-10-01' }, { de: '2024-01-01', ate: '2026-10-01' },
    { ap: 'nao-e-mac' }, { ssid: 'x'.repeat(65) },
  ];
  for (const q of ruins) assert.throws(() => montarFiltrosLgpd(q, 1), (e) => e.status === 400, JSON.stringify(q));
  assert.throws(() => montarFiltrosLgpd({ origem: ['a'] }, 1), (e) => e.status === 400);
});

test('getAllLgpd e exportarLgpdCSV usam os filtros; invalido responde 400 sem consultar', async () => {
  const db = criarDb(async () => [[]]);
  const c = ctrl(db);
  const res = criarRes();
  await c.getAllLgpd(criarReq({ empresa_id: 3, query: { origem: 'lgpd', aceite: '1' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(db.calls[0].params, [3, 'lgpd', 1]);

  const res2 = criarRes();
  await c.exportarLgpdCSV(criarReq({ empresa_id: 3, query: { ssid: 'Loja' } }), res2);
  assert.deepStrictEqual(db.calls[1].params, [3, 'Loja']);
  assert.match(db.calls[1].sql, /l\.ssid = \?/);

  const antes = db.calls.length;
  const restaura = silencia();
  const res3 = criarRes();
  await c.getAllLgpd(criarReq({ empresa_id: 3, query: { aceite: 'x' } }), res3);
  const res4 = criarRes();
  await c.exportarLgpdCSV(criarReq({ empresa_id: 3, query: { de: 'foo' } }), res4);
  restaura();
  assert.strictEqual(res3.statusCode, 400);
  assert.strictEqual(res4.statusCode, 400);
  assert.strictEqual(db.calls.length, antes);
});

test('getFiltrosLgpd escopa por empresa e devolve origens, ssids e aps', async () => {
  const db = criarDb(async (sql) => {
    if (/DISTINCT l\.origem/.test(sql)) return [[{ origem: 'lgpd' }]];
    if (/DISTINCT l\.ssid/.test(sql)) return [[{ ssid: 'Loja' }]];
    return [[{ ap_mac: 'AA:BB:CC:DD:EE:FF', ap_nome: 'AP1' }]];
  });
  const res = criarRes();
  await ctrl(db).getFiltrosLgpd(criarReq({ empresa_id: 4 }), res);
  assert.deepStrictEqual(res.body.origens, ['lgpd']);
  assert.deepStrictEqual(res.body.ssids, ['Loja']);
  assert.ok(Array.isArray(res.body.equipamentos));
  assert.ok(db.calls.every((c) => c.params[0] === 4 && /l\.empresa_id = \?/.test(c.sql)));
});

test('equipamento: filtra por l.mikrotik_id, valida o inteiro e so entra se a coluna existe (migration 056)', async () => {
  const { montarFiltrosLgpd } = ctrl(criarDb());
  const f = montarFiltrosLgpd({ equipamento: '7' }, 3);
  assert.match(f.where, /l\.mikrotik_id = \?/);
  assert.deepStrictEqual(f.params, [3, 7]);
  for (const ruim of ['0', '-1', 'abc', '1 OR 1=1', '99999999999']) {
    assert.throws(() => montarFiltrosLgpd({ equipamento: ruim }, 3), (e) => e.status === 400, ruim);
  }
  // sem a coluna: o filtro e' ignorado (nao quebra a consulta)
  const g = montarFiltrosLgpd({ equipamento: '7' }, 3, { comEquipamento: false });
  assert.ok(!/mikrotik_id/.test(g.where));
  assert.deepStrictEqual(g.params, [3]);
});

test('lista e CSV trazem o equipamento (JOIN escopado por empresa); sem a coluna usam NULL', async () => {
  const db = criarDb(async () => [[]]);
  const c = ctrl(db, true);
  await c.getAllLgpd(criarReq({ empresa_id: 3, query: { equipamento: '7' } }), criarRes());
  assert.match(db.calls[0].sql, /m\.nome AS equipamento_nome/);
  assert.match(db.calls[0].sql, /LEFT JOIN mikrotiks m ON m\.id = l\.mikrotik_id AND m\.empresa_id = l\.empresa_id/);
  assert.deepStrictEqual(db.calls[0].params, [3, 7]);
  const res = criarRes();
  await c.exportarLgpdCSV(criarReq({ empresa_id: 3, query: {} }), res);
  assert.match(res.body, /Equipamento/);

  const db2 = criarDb(async () => [[]]);
  await ctrl(db2, false).getAllLgpd(criarReq({ empresa_id: 3, query: { equipamento: '7' } }), criarRes());
  assert.match(db2.calls[0].sql, /NULL AS equipamento_nome/);
  assert.ok(!/JOIN mikrotiks/.test(db2.calls[0].sql));
});

test('gravarEquipamentoLead: so equipamento da propria empresa, so se NULL, e nunca derruba o portal', async () => {
  const { carregar: c2 } = require('../helpers/mocks');
  const mk = (handler) => {
    const db = criarDb(handler);
    const u = c2('src/utils/leadUtils.js', { db });
    return { db, u };
  };
  // equipamento de outra empresa => nao grava
  let m = mk(async (sql) => (/FROM mikrotiks/.test(sql) ? [[]] : undefined));
  await m.u.gravarEquipamentoLead(5, { cpf: '52998224725' }, 9);
  assert.ok(!m.db.calls.some((c) => /UPDATE leads/.test(c.sql)));
  // equipamento da empresa => UPDATE so onde mikrotik_id IS NULL, escopado
  m = mk(async (sql) => (/FROM mikrotiks/.test(sql) ? [[{ id: 9 }]] : undefined));
  await m.u.gravarEquipamentoLead(5, { cpf: '52998224725' }, 9);
  const up = m.db.calls.find((c) => /UPDATE leads/.test(c.sql));
  assert.match(up.sql, /mikrotik_id IS NULL/);
  assert.match(up.sql, /empresa_id = \?/);
  assert.deepStrictEqual(up.params, [9, 5, '52998224725']);
  // id invalido / coluna ausente => silencioso
  m = mk(async () => { throw Object.assign(new Error("Unknown column 'mikrotik_id'"), {}); });
  await assert.doesNotReject(() => m.u.gravarEquipamentoLead(5, { mac: 'AA:BB' }, 9));
  await m.u.gravarEquipamentoLead(5, { cpf: '1' }, 'x');
});

test('exportarContatosLgpd: usa os filtros da tela, so com telefone, escopado e valida formato/filtro', async () => {
  const db = criarDb(async () => [[
    { nome: 'Maria da Silva', email: 'm@x.com', telefone: '(93) 99193-5695' },
    { nome: 'Sem Tel', email: '', telefone: '123' },
  ]]);
  const c = ctrl(db, true);
  const res = criarRes();
  await c.exportarContatosLgpd(criarReq({ empresa_id: 3, query: { formato: 'google', origem: 'lgpd', equipamento: '7' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const q = db.calls[0];
  assert.match(q.sql, /l\.telefone IS NOT NULL AND l\.telefone <> ''/);
  assert.match(q.sql, /l\.mikrotik_id = \?/);
  assert.match(q.sql, /LIMIT 50000/);
  assert.deepStrictEqual(q.params, [3, 'lgpd', 7]);
  assert.match(res.body, /\+5593991935695/);
  assert.strictEqual(res.headers['X-Total-Contatos'], '1');
  assert.match(res.headers['Content-Disposition'], /contatos-google\.csv/);

  const restaura = silencia();
  const r2 = criarRes();
  await c.exportarContatosLgpd(criarReq({ empresa_id: 3, query: { formato: 'xml' } }), r2);
  const r3 = criarRes();
  await c.exportarContatosLgpd(criarReq({ empresa_id: 3, query: { formato: 'vcard', aceite: '9' } }), r3);
  restaura();
  assert.strictEqual(r2.statusCode, 400);
  assert.strictEqual(r3.statusCode, 400);
  assert.strictEqual(db.calls.length, 1);
});
