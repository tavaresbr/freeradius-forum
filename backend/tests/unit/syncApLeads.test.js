// syncConnectionLogs.completarApDosLeads: completa AP/SSID so onde esta NULL, escopado por empresa; falha nao propaga.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar } = require('../helpers/mocks');

const job = (db) => carregar('src/jobs/syncConnectionLogs.js', { db });

test('UPDATE so preenche NULL, junta por empresa_id e usa janela de 1 dia', async () => {
  const db = criarDb(async () => [{ affectedRows: 3 }]);
  const n = await job(db).completarApDosLeads(db, 1);
  assert.strictEqual(n, 3);
  const c = db.calls[0];
  assert.match(c.sql, /UPDATE leads l/);
  assert.match(c.sql, /c\.empresa_id = l\.empresa_id/);
  assert.match(c.sql, /WHERE l\.ap_mac IS NULL AND l\.ssid IS NULL/);
  assert.match(c.sql, /DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
  assert.deepStrictEqual(c.params, [1]);
});

test('backfill (desdeDias null) varre todo o historico, sem janela', async () => {
  const db = criarDb(async () => [{ affectedRows: 0 }]);
  await job(db).completarApDosLeads(db, null);
  assert.ok(!/DATE_SUB/.test(db.calls[0].sql));
  assert.deepStrictEqual(db.calls[0].params, []);
});

test('erro no UPDATE nao propaga (nao derruba o sync)', async () => {
  const db = criarDb(async () => { throw new Error('boom'); });
  const w = console.warn; console.warn = () => {};
  try { assert.strictEqual(await job(db).completarApDosLeads(db, 1), 0); } finally { console.warn = w; }
});
