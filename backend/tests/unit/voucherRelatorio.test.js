// Relatorio de vouchers usados: periodo, isolamento por empresa, consumo e CSV.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

function ctrl(handler) {
  const db = criarDb(handler);
  return { c: carregar('src/controllers/voucherRelatorioController.js', { db }), db };
}

test('relatorio: periodo padrao = 30 dias, valida formato, ordem e limite de 366 dias', () => {
  const { c } = ctrl(async () => undefined);
  const p = c._periodoRelatorio({}, new Date('2026-10-27T12:00:00Z'));
  assert.deepStrictEqual(p, { de: '2026-09-28', ate: '2026-10-27' });
  assert.deepStrictEqual(c._periodoRelatorio({ de: '2026-01-01', ate: '2026-01-31' }), { de: '2026-01-01', ate: '2026-01-31' });
  assert.ok(c._periodoRelatorio({ de: '2026-02-01', ate: '2026-01-01' }).erro); // invertido
  assert.ok(c._periodoRelatorio({ de: '2024-01-01', ate: '2026-01-01' }).erro); // > 366 dias
  assert.deepStrictEqual(c._periodoRelatorio({ de: '2026-02-30', ate: '2026-03-10' }, new Date('2026-03-10T00:00:00Z')), { de: '2026-02-09', ate: '2026-03-10' }); // data invalida cai no padrao
  assert.deepStrictEqual(c._periodoRelatorio({ de: { $ne: 1 }, ate: ['x'] }, new Date('2026-10-27T00:00:00Z')), { de: '2026-09-28', ate: '2026-10-27' });
});

function handlerPadrao(sql) {
  if (/SUM\(v\.status = 'usado'\) AS usados, SUM\(v\.status = 'disponivel'\)/.test(sql)) return [[{ usados: 8, disponiveis: 12, cancelados: 1 }]];
  if (/GROUP BY dia/.test(sql)) return [[{ dia: '2026-10-26', n: 1 }, { dia: '2026-10-27', n: 1 }]];
  if (/GROUP BY v\.mikrotik_id/.test(sql)) return [[{ equipamento_id: 3, equipamento_nome: 'RB03', usados_periodo: '2', usados_total: '8', disponiveis: '12', cancelados: '1' }]];
  if (/GROUP BY v\.lote/.test(sql)) return [[{ lote: null, usados_periodo: '2', usados_total: '8', disponiveis: '12', cancelados: '1' }]];
  if (/COUNT\(\*\) AS n FROM vouchers v WHERE/.test(sql) && !/GROUP BY/.test(sql)) return [[{ n: 2 }]];
  if (/FROM radacct/.test(sql)) return [[{ username: 'voucher_aaaa1111', usado: '1800' }]];
  if (/FROM vouchers v\s+LEFT JOIN planos/.test(sql)) {
    return [[
      { id: 1, codigo: 'AAAA1111', lote: 'L1', usado_em: '2026-10-27T10:00:00Z', usado_mac: 'AA:BB:CC:DD:EE:01', usado_ip: '10.0.0.9', username: 'voucher_aaaa1111', plano_nome: 'Plano 60', plano_minutos: 60, equipamento_nome: 'RB03', usado_equipamento: 'RB03' },
      { id: 2, codigo: '=CMD1234', lote: null, usado_em: '2026-10-26T10:00:00Z', usado_mac: null, usado_ip: null, username: 'voucher_x', plano_nome: 'Plano 60', plano_minutos: 60, equipamento_nome: 'RB03', usado_equipamento: null },
    ]];
  }
  return undefined;
}

test('relatorio: resumo, por dia/equipamento/lote, consumo por voucher e tudo escopado por empresa', async () => {
  const { c, db } = ctrl(async (sql) => handlerPadrao(sql));
  const res = criarRes();
  await c.relatorio(criarReq({ empresa_id: 7, query: { de: '2026-10-01', ate: '2026-10-31', equipamento: '3', lote: 'L1' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.resumo.usados_periodo, 2);
  assert.strictEqual(res.body.resumo.taxa_uso, 40); // 8 usados / (8 + 12 disponiveis)
  assert.strictEqual(res.body.por_dia.length, 2);
  assert.strictEqual(res.body.por_equipamento[0].usados_periodo, 2);
  assert.strictEqual(res.body.data[0].consumido_segundos, 1800);
  assert.strictEqual(res.body.data[0].total_segundos, 3600);
  assert.strictEqual(res.body.data[1].consumido_segundos, null); // sem radacct
  const vouchersQ = db.calls.filter((x) => /FROM vouchers v/.test(x.sql));
  assert.ok(vouchersQ.length >= 6);
  for (const q of vouchersQ) {
    assert.match(q.sql, /v\.empresa_id = \?/);
    assert.ok(q.params.includes(7));
  }
  const detalhe = vouchersQ.find((x) => /v\.usado_mac/.test(x.sql));
  assert.match(detalhe.sql, /v\.status = 'usado'/);
  assert.match(detalhe.sql, /m\.empresa_id = v\.empresa_id/);
  assert.match(detalhe.sql, /mu\.empresa_id = v\.empresa_id/);
});

test('relatorio: periodo invalido = 400 sem tocar o banco; radacct fora do ar nao derruba', async () => {
  let { c, db } = ctrl(async (sql) => handlerPadrao(sql));
  let res = criarRes();
  await c.relatorio(criarReq({ empresa_id: 7, query: { de: '2026-12-01', ate: '2026-01-01' } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(db.calls.length, 0);
  ({ c } = ctrl(async (sql) => { if (/FROM radacct/.test(sql)) throw new Error('radacct off'); return handlerPadrao(sql); }));
  res = criarRes(); const un = silencia();
  try { await c.relatorio(criarReq({ empresa_id: 7, query: {} }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data[0].consumido_segundos, null);
});

test('relatorio CSV: colunas, horas e protecao contra injecao de formula', async () => {
  const { c } = ctrl(async (sql) => handlerPadrao(sql));
  const res = criarRes();
  await c.relatorioCSV(criarReq({ empresa_id: 7, query: { de: '2026-10-01', ate: '2026-10-31' } }), res);
  const csv = String(res.body);
  assert.match(csv, /Codigo;Plano;Equipamento do voucher;Usado no equipamento;Lote;Usado em;MAC;IP;Tempo do plano;Tempo consumido/);
  assert.match(csv, /AAAA1111;Plano 60;RB03;RB03;L1;.*;AA:BB:CC:DD:EE:01;10\.0\.0\.9;1h00;0h30/);
  assert.match(csv, /'=CMD1234/);
  assert.match(res.headers['Content-Disposition'] || res.headers['content-disposition'], /vouchers-usados-2026-10-01-a-2026-10-31\.csv/);
});
