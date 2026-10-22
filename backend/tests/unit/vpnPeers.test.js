const test = require('node:test');
const assert = require('node:assert');
const { peersLivres } = require('../../src/utils/vpnPeers');

const agora = Date.parse('2026-10-22T10:20:00Z');
const peers = [
  { name: 'RB04', address: '10.8.0.4', latestHandshakeAt: '2026-10-22T10:19:00Z' },
  { name: 'RB02', address: '10.8.0.2/24', latestHandshakeAt: '2026-10-22T09:47:18Z' },
  { name: 'RB03', address: '10.8.0.3', latestHandshakeAt: null },
];

test('remove peers cujo IP já é equipamento e ordena por nome', () => {
  const r = peersLivres(peers, ['10.8.0.3'], agora);
  assert.deepStrictEqual(r.map((p) => p.nome), ['RB02', 'RB04']);
});

test('tira a máscara do IP e marca online só com handshake recente', () => {
  const r = peersLivres(peers, [], agora);
  assert.deepStrictEqual(r.map((p) => [p.nome, p.ip, p.online]),
    [['RB02', '10.8.0.2', false], ['RB03', '10.8.0.3', false], ['RB04', '10.8.0.4', true]]);
});

test('todos cadastrados e entradas vazias', () => {
  assert.deepStrictEqual(peersLivres(peers, ['10.8.0.2', '10.8.0.3', '10.8.0.4'], agora), []);
  assert.deepStrictEqual(peersLivres(undefined, undefined), []);
  assert.deepStrictEqual(peersLivres([{ name: 'x' }], []), []);
});
