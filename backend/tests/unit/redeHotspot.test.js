// Calculo da rede do hotspot (/24, /23, /22), pool e sobreposicao.
const test = require('node:test');
const assert = require('node:assert');
const { calcularRede, validarPool, redesSobrepoem } = require('../../src/utils/redeHotspot');
const { configurarHotspot } = require('../../src/utils/hotspotSetup');

test('calcularRede: /24 padrao e pool padrao (todos os hosts menos o gateway)', () => {
  const r = calcularRede('10.5.50.1/24');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.network, '10.5.50.0/24');
  assert.strictEqual(r.gateway, '10.5.50.1');
  assert.strictEqual(r.hosts, 254);
  assert.strictEqual(r.poolPadrao, '10.5.50.2-10.5.50.254');
});

test('calcularRede: /22 alinha a rede de verdade (antes virava 10.5.50.0/22)', () => {
  const r = calcularRede('10.5.50.1/22');
  assert.strictEqual(r.network, '10.5.48.0/22');
  assert.strictEqual(r.hosts, 1022);
  assert.strictEqual(r.poolPadrao, '10.5.48.1-10.5.50.0,10.5.50.2-10.5.51.254');
  assert.strictEqual(validarPool(r.poolPadrao, r).ok, true);
  const g = calcularRede('10.5.48.1/22');
  assert.strictEqual(g.network, '10.5.48.0/22');
  assert.strictEqual(g.poolPadrao, '10.5.48.2-10.5.51.254');
  assert.strictEqual(calcularRede('10.5.50.1/23').network, '10.5.50.0/23');
  assert.strictEqual(calcularRede('10.5.51.1/23').network, '10.5.50.0/23');
});

test('calcularRede: recusa IP invalido, prefixo fora de /16-/29 e gateway = rede/broadcast', () => {
  for (const x of ['', 'abc', '10.5.50.300/24', '10.5.50.1/8', '10.5.50.1/30', '10.5.50.1/xx', '10.5.48.0/22', '10.5.51.255/22']) {
    assert.strictEqual(calcularRede(x).ok, false, x);
  }
  assert.strictEqual(calcularRede('10.5.50.1').prefixo, 24);
});

test('validarPool: dentro da rede, sem o gateway, faixas validas', () => {
  const r = calcularRede('10.5.48.1/22');
  assert.strictEqual(validarPool('10.5.48.2-10.5.51.254', r).ok, true);
  assert.strictEqual(validarPool('10.5.48.2-10.5.48.100,10.5.49.1-10.5.49.50', r).ok, true);
  assert.match(validarPool('10.5.48.1-10.5.51.254', r).erro, /gateway/);
  assert.match(validarPool('10.5.48.2-10.5.52.10', r).erro, /sai da rede/);
  assert.match(validarPool('10.5.50.2-10.5.50.1', r).erro, /invalida/);
  assert.match(validarPool('', r).erro, /Informe/);
  assert.strictEqual(validarPool('10.5.48.2-10.5.51.255', r).ok, false);
});

test('redesSobrepoem: /22 cobre o /24 vizinho; redes distintas nao', () => {
  assert.strictEqual(redesSobrepoem('10.5.48.1/22', '10.5.50.1/24'), true);
  assert.strictEqual(redesSobrepoem('10.5.50.1/24', '10.5.48.1/22'), true);
  assert.strictEqual(redesSobrepoem('10.5.48.1/22', '10.5.52.1/24'), false);
  assert.strictEqual(redesSobrepoem('10.5.50.1/24', '192.168.88.1/24'), false);
  assert.strictEqual(redesSobrepoem('lixo', '10.5.50.1/24'), false);
});

test('configurarHotspot: rede ou pool invalido para ANTES de conectar e de escrever', async () => {
  const mk = { id: 1, ip: '203.0.113.9', usuario: 'x', senha: 'y' }; // IP de documentacao: se tentasse conectar, falharia por rede
  const a = await configurarHotspot(mk, null, 'portal.exemplo', { localAddress: '10.5.50.1/30x' }, {}, null);
  assert.strictEqual(a.success, false);
  assert.strictEqual(a.steps[0].step, 'rede');
  assert.ok(!a.steps.some((s) => s.step === 'conexao'));
  const b = await configurarHotspot(mk, null, 'portal.exemplo', { localAddress: '10.5.48.1/22', poolRange: '10.5.48.2-10.5.55.254' }, {}, null);
  assert.strictEqual(b.success, false);
  assert.match(b.steps[0].message, /sai da rede/);
});
