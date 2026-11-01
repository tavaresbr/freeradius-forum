const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// db falso injetado antes de carregar o controller
const chamadas = [];
let peerDaEmpresa = true;
let repetido = false;
const dbFalso = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/SELECT id FROM empresa_vpn_peers WHERE wg_client_id = \? AND empresa_id/.test(sql)) return [[peerDaEmpresa ? { id: 1 } : undefined]];
    if (/LOWER\(nome\)/.test(sql)) return [[repetido ? { id: 2 } : undefined]];
    return [{ affectedRows: 1 }];
  },
};
const orig = Module._load;
Module._load = function (req, ...r) {
  if (/(^|\/)db$|\/db\.js$/.test(req) && !/node_modules/.test(req)) return dbFalso;
  return orig.call(this, req, ...r);
};
const ctrl = require('../../src/controllers/wireguardController');
Module._load = orig;

function res() { return { c: 200, b: null, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; } }; }
const req = (name, id = 'abc-123') => ({ params: { id }, body: { name }, empresa_id: 7 });

test('nome vazio, muito longo ou nao string => 400', async () => {
  for (const n of ['', '   ', 'x'.repeat(61), 5, null]) {
    const r = res(); await ctrl.renameClient(req(n), r); assert.strictEqual(r.c, 400);
  }
});

test('peer de outra empresa => 403 e nao grava', async () => {
  peerDaEmpresa = false; chamadas.length = 0;
  const r = res(); await ctrl.renameClient(req('RB11'), r);
  assert.strictEqual(r.c, 403);
  assert.ok(!chamadas.some((c) => /UPDATE/.test(c.sql)));
  peerDaEmpresa = true;
});

test('nome ja usado por outro peer => 409', async () => {
  repetido = true;
  const r = res(); await ctrl.renameClient(req('RB10'), r);
  assert.strictEqual(r.c, 409);
  repetido = false;
});

test('sucesso: UPDATE escopado por empresa e nome aparado', async () => {
  chamadas.length = 0;
  const r = res(); await ctrl.renameClient(req('  RB11  '), r);
  assert.strictEqual(r.c, 200);
  assert.strictEqual(r.b.name, 'RB11');
  const up = chamadas.find((c) => /UPDATE empresa_vpn_peers/.test(c.sql));
  assert.ok(/empresa_id = \?/.test(up.sql));
  assert.deepStrictEqual(up.params, ['RB11', 'abc-123', 7]);
});

test('auditoria reconhece a rota', () => {
  const { classificar } = require('../../src/utils/auditoria');
  const c = classificar('PUT', '/api/wireguard/clients/3f2a-bb91');
  assert.strictEqual(c.acao, 'vpn.renomear');
});
