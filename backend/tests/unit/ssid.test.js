const test = require('node:test');
const assert = require('node:assert');
const { ssidDoPeer, SSID_PADRAO } = require('../../src/utils/ssid');

test('nome simples vira o SSID', () => {
  assert.strictEqual(ssidDoPeer('RB02'), 'RB02');
});

test('tira acento e caracteres que quebram o RouterOS', () => {
  assert.strictEqual(ssidDoPeer('Padaria São João'), 'Padaria Sao Joao');
  assert.strictEqual(ssidDoPeer('a"b$c[d]e?f\\g'), 'a b c d e f g');
});

test('limita a 32 caracteres', () => {
  const r = ssidDoPeer('x'.repeat(50));
  assert.strictEqual(r.length, 32);
});

test('vazio ou so simbolos cai no padrao', () => {
  assert.strictEqual(ssidDoPeer(''), SSID_PADRAO);
  assert.strictEqual(ssidDoPeer(null), SSID_PADRAO);
  assert.strictEqual(ssidDoPeer('"$[]'), SSID_PADRAO);
});
