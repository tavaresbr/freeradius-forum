const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const { peersLivres } = require('../../src/utils/vpnPeers');

// O controller le o docker-compose do wg-easy (nao existe fora do servidor): devolve um conteudo fixo so para ele.
const fs = require('node:fs');
const lerOriginal = fs.readFileSync;
fs.readFileSync = (p, ...a) => (/docker-compose\.yml$/.test(String(p)) ? 'WG_PORT=51820\nWG_HOST=1.2.3.4\nPORT=51821\n' : lerOriginal.call(fs, p, ...a));

const AXIOS = path.relative(path.resolve(__dirname, '../..'), require.resolve('axios'));
const CONF = '[Interface]\nPrivateKey = abc\nAddress = 10.8.0.9/24\n[Peer]\nPublicKey = srv\nEndpoint = 1.2.3.4:51820\n';

function setup({ comTipo = true, tipoDoPeer } = {}) {
  const wg = [];
  const axios = async ({ method, url, data }) => {
    if (method === 'POST' && url.endsWith('/api/wireguard/client')) { wg.push({ id: 'id' + (wg.length + 1), name: data.name }); return { data: {} }; }
    if (method === 'GET' && url.endsWith('/api/wireguard/client')) return { data: wg.slice() };
    if (method === 'GET' && /configuration$/.test(url)) return { data: CONF };
    return { data: {} };
  };
  axios.post = async () => ({ headers: { 'set-cookie': ['c=1; Path=/'] } });
  const db = criarDb((sql) => {
    if (/SELECT nome(, tipo)? FROM empresa_vpn_peers/.test(sql)) return [[{ nome: 'CLIENTE-02', tipo: tipoDoPeer }]];
    if (/SELECT id FROM empresa_vpn_peers WHERE wg_client_id/.test(sql)) return [[{ id: 1 }]];
  });
  const mod = carregar('src/controllers/wireguardController.js', {
    db,
    extras: { [AXIOS]: axios, 'src/utils/schemaCache.js': { temColuna: async () => comTipo, limparCache() {} } },
  });
  return { mod, db };
}

test('createClient grava o tipo escolhido e o devolve', async () => {
  const { mod, db } = setup();
  const res = criarRes();
  await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'OMADA-01', tipo: 'omada' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tipo, 'omada');
  const ins = db.calls.find((c) => /INSERT INTO empresa_vpn_peers/.test(c.sql));
  assert.match(ins.sql, /\btipo\b/);
  assert.deepEqual(ins.params, [7, 'id1', 'OMADA-01', 'omada']);
});

test('createClient sem tipo assume mikrotik', async () => {
  const { mod, db } = setup();
  const res = criarRes();
  await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'RB-01' } }), res);
  assert.equal(res.body.tipo, 'mikrotik');
  assert.deepEqual(db.calls.find((c) => /INSERT INTO empresa_vpn_peers/.test(c.sql)).params, [7, 'id1', 'RB-01', 'mikrotik']);
});

test('createClient recusa tipo invalido (400) sem criar nada', async () => {
  for (const tipo of ['cisco', 5, {}, '']) {
    const { mod, db } = setup();
    const res = criarRes();
    await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'X-01', tipo } }), res);
    assert.equal(res.statusCode, 400);
    assert.ok(!db.calls.some((c) => /INSERT/.test(c.sql)));
  }
});

test('sem a migration 078: mikrotik segue funcionando e outro tipo responde 503', async () => {
  let { mod, db } = setup({ comTipo: false });
  let res = criarRes();
  await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'RB-01', tipo: 'mikrotik' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.calls.find((c) => /INSERT INTO empresa_vpn_peers/.test(c.sql)).params, [7, 'id1', 'RB-01']);

  ({ mod, db } = setup({ comTipo: false }));
  res = criarRes();
  await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'OM-01', tipo: 'omada' } }), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /078_vpn_peers_tipo/);
  assert.ok(!db.calls.some((c) => /INSERT/.test(c.sql)));
});

test('getClientConfig: peer nao-MikroTik recebe so o .conf (sem script RouterOS)', async () => {
  const { mod } = setup({ tipoDoPeer: 'unifi' });
  const res = criarRes();
  await mod.getClientConfig(criarReq({ empresa_id: 7, params: { id: 'id1' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tipo, 'unifi');
  assert.equal(res.body.routerOsScript, null);
  assert.match(res.body.conf, /PrivateKey/);
});

test('getClientConfig: peer MikroTik (ou sem tipo gravado) continua com o script', async () => {
  for (const tipoDoPeer of ['mikrotik', undefined]) {
    const { mod } = setup({ tipoDoPeer });
    const res = criarRes();
    await mod.getClientConfig(criarReq({ empresa_id: 7, params: { id: 'id1' } }), res);
    assert.equal(res.body.tipo, 'mikrotik');
    assert.match(res.body.routerOsScript, /interface wireguard/);
  }
});

test('renameClient atualiza o tipo e recusa tipo invalido', async () => {
  const { mod, db } = setup();
  let res = criarRes();
  await mod.renameClient(criarReq({ empresa_id: 7, params: { id: 'id1' }, body: { name: 'NOVO-01', tipo: 'grandstream' } }), res);
  assert.equal(res.statusCode, 200);
  const up = db.calls.find((c) => /UPDATE empresa_vpn_peers/.test(c.sql));
  assert.deepEqual(up.params, ['NOVO-01', 'grandstream', 'id1', 7]);

  res = criarRes();
  await mod.renameClient(criarReq({ empresa_id: 7, params: { id: 'id1' }, body: { name: 'NOVO-01', tipo: 'xyz' } }), res);
  assert.equal(res.statusCode, 400);
});

test('peersLivres propaga o tipo (padrao mikrotik)', () => {
  const r = peersLivres([
    { name: 'A', address: '10.8.0.4/24', tipo: 'omada' },
    { name: 'B', address: '10.8.0.5/24' },
  ], []);
  assert.deepEqual(r.map((p) => [p.nome, p.tipo]), [['A', 'omada'], ['B', 'mikrotik']]);
});
