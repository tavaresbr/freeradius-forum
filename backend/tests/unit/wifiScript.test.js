const test = require('node:test');
const assert = require('node:assert');
const { linhasWifi } = require('../../src/utils/wifiScript');

const [linha] = linhasWifi('RB02');

test('uma unica linha, tenta wifi (hAP ax) primeiro e wireless como alternativa', () => {
  assert.strictEqual(linhasWifi('RB02').length, 1);
  assert.ok(!linha.includes('\n'));
  assert.ok(linha.indexOf('/interface wifi configuration') < linha.indexOf('/interface wireless set'));
});

test('hAP ax: SSID, aberto, clientes isolados e interfaces ligadas', () => {
  assert.ok(linha.includes('ssid=\\"RB02\\"'));
  assert.ok(linha.includes('datapath.client-isolation=yes'));
  assert.ok(linha.includes('/interface wifi set \\5Bfind\\5D configuration=cfg-hotspot disabled=no'));
  assert.ok(!linha.includes('security'));
});

test('dentro das aspas nao sobra colchete cru nem aspas sem escape', () => {
  const dentro = [...linha.matchAll(/\[\[:parse "((?:[^"\\]|\\.)*)"\]\]/g)].map((m) => m[1]);
  assert.strictEqual(dentro.length, 2);
  for (const d of dentro) assert.ok(!/[\[\]]/.test(d));
});

test('chaves e aspas da linha final balanceadas', () => {
  const semEscapes = linha.replace(/\\./g, '');
  assert.strictEqual((semEscapes.match(/"/g) || []).length % 2, 0);
  const fora = semEscapes.replace(/"[^"]*"/g, '');
  assert.strictEqual((fora.match(/\{/g) || []).length, (fora.match(/\}/g) || []).length);
});
