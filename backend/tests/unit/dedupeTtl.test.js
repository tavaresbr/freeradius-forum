const test = require('node:test');
const assert = require('node:assert');
const { criarDedupe } = require('../../src/utils/dedupeTtl');

test('repeticao dentro da janela e ignorada; depois do TTL conta de novo', () => {
  let t = 1000;
  const d = criarDedupe({ ttlMs: 100, agora: () => t });
  assert.strictEqual(d.jaVisto('a'), false);
  assert.strictEqual(d.jaVisto('a'), true);
  assert.strictEqual(d.jaVisto('b'), false);
  t += 101;
  assert.strictEqual(d.jaVisto('a'), false);
});

test('teto de chaves: descarta expiradas e depois as mais antigas', () => {
  let t = 0;
  const d = criarDedupe({ ttlMs: 1000, maxChaves: 3, agora: () => t });
  ['a', 'b', 'c'].forEach((k) => d.jaVisto(k));
  t += 2000; // todas expiram
  d.jaVisto('d');
  assert.ok(d.tamanho() <= 3);
  ['e', 'f', 'g', 'h', 'i'].forEach((k) => d.jaVisto(k));
  assert.ok(d.tamanho() <= 4, `tamanho ${d.tamanho()}`);
});
