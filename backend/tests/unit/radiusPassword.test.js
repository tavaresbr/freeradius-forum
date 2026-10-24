const test = require('node:test');
const assert = require('node:assert');
const { gerarSenhaRadius, ehSenhaLegada, ALFABETO } = require('../../src/utils/radiusPassword');

test('gera 8 chars do alfabeto digitavel por padrao', () => {
  const s = gerarSenhaRadius();
  assert.strictEqual(s.length, 8);
  for (const c of s) assert.ok(ALFABETO.includes(c));
  assert.match(s, /^[a-z2-9]+$/);
});

test('nao usa caracteres ambiguos', () => {
  assert.doesNotMatch(ALFABETO, /[01oil]/);
});

test('respeita tamanho e limites', () => {
  assert.strictEqual(gerarSenhaRadius(12).length, 12);
  assert.strictEqual(gerarSenhaRadius(1).length, 6);
  assert.strictEqual(gerarSenhaRadius(999).length, 32);
});

test('senhas distintas (entropia basica)', () => {
  const set = new Set(Array.from({ length: 500 }, () => gerarSenhaRadius()));
  assert.strictEqual(set.size, 500);
});

test('ehSenhaLegada detecta senha == username', () => {
  assert.strictEqual(ehSenhaLegada('12345678900', '12345678900'), true);
  assert.strictEqual(ehSenhaLegada('12345678900', 'abcd2345'), false);
  assert.strictEqual(ehSenhaLegada('', ''), false);
});
