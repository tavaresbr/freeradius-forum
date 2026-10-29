const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

function setup() {
  const wg = []; // peers no wg-easy
  const axios = async ({ method, url, data }) => {
    if (method === 'POST' && url.endsWith('/api/wireguard/client')) { wg.push({ id: 'id' + (wg.length + 1), name: data.name }); return { data: {} }; }
    if (method === 'GET' && url.endsWith('/api/wireguard/client')) return { data: wg.slice() };
    return { data: {} };
  };
  axios.post = async () => ({ headers: { 'set-cookie': ['c=1; Path=/'] } });
  const db = criarDb();
  const mod = carregar('src/controllers/wireguardController.js', { db, extras: { [require('node:path').relative(require('node:path').resolve(__dirname, '../..'), require.resolve('axios'))]: axios } });
  return { mod, db, wg };
}

test('createClient devolve o id do peer e grava o nome digitado', async () => {
  const { mod, db } = setup();
  const res = criarRes();
  await mod.createClient(criarReq({ empresa_id: 7, body: { name: 'TAVARES-FIBRA-01' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 'id1');
  assert.equal(res.body.name, 'TAVARES-FIBRA-01');
  const ins = db.calls.find((c) => /INSERT INTO empresa_vpn_peers/.test(c.sql));
  assert.deepEqual(ins.params, [7, 'id1', 'TAVARES-FIBRA-01']);
});
