const test = require('node:test');
const assert = require('node:assert');
const { linhasWifi } = require('../../src/utils/wifiScript');

const linhas = linhasWifi('RB02');
const ESS = 'mode=ap-bridge ssid="RB02" disabled=no';

test('varias linhas independentes, sem quebra de linha dentro de cada uma', () => {
  assert.ok(linhas.length > 3);
  for (const l of linhas) assert.ok(!l.includes('\n'));
});

test('wireless: set essencial primeiro, sem [:parse], opcionais cada um na sua linha', () => {
  assert.ok(linhas[0].includes(ESS));
  assert.ok(!linhas[0].includes(':parse'));
  for (const arg of ['default-forwarding=no', 'band=2ghz-b/g/n', 'frequency-mode=regulatory-domain', 'country=brazil']) {
    const i = linhas.findIndex((l) => l.includes(arg));
    assert.ok(i > 0, arg);
    assert.ok(!linhas[i].includes('ssid='), `${arg} junto do SSID`);
    assert.ok(!linhas[i].includes(':parse'));
  }
});

test('hAP ax: ramo wifi em linha propria com :parse, SSID, aberto e isolamento', () => {
  const l = linhas.find((x) => x.includes('/interface wifi configuration'));
  assert.ok(l && l.includes(':local f [:parse') && l.includes('; $f }'));
  assert.ok(!l.includes('[[:parse'));
  assert.ok(l.includes('ssid=\\"RB02\\"'));
  assert.ok(l.includes('datapath.client-isolation=yes'));
  assert.ok(l.includes('/interface wifi set \\5Bfind\\5D configuration=cfg-hotspot disabled=no'));
  assert.ok(!l.includes('security'));
  const dentro = [...l.matchAll(/\[:parse "((?:[^"\\]|\\.)*)"\]; \$f/g)].map((m) => m[1]);
  assert.strictEqual(dentro.length, 1);
  assert.ok(!/[\[\]]/.test(dentro[0]));
});

test('ultima linha le o estado real do wlan1 (modo e SSID)', () => {
  const ultima = linhas[linhas.length - 1];
  assert.ok(ultima.includes('/interface wireless get') && ultima.includes('mode') && ultima.includes('ssid'));
});

test('chaves e aspas de cada linha balanceadas', () => {
  for (const l of linhas) {
    const semEscapes = l.replace(/\\./g, '');
    assert.strictEqual((semEscapes.match(/"/g) || []).length % 2, 0, l);
    const fora = semEscapes.replace(/"[^"]*"/g, '');
    assert.strictEqual((fora.match(/\{/g) || []).length, (fora.match(/\}/g) || []).length, l);
  }
});
