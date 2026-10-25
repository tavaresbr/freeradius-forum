const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const chamadas = [];
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    return [/INSERT INTO admins/.test(sql) ? { insertId: 77 } : { affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
const Admin = require('../../src/models/Admin');

test('Admin.create vincula o novo admin a empresa em admin_empresas (senao o login da 403)', async () => {
  chamadas.length = 0;
  const id = await Admin.create('adm@x.com', 'hash', 5, 'owner', 'Fulano');
  assert.strictEqual(id, 77);
  const vinc = chamadas.find((c) => /INSERT INTO admin_empresas/.test(c.sql));
  assert.ok(vinc, 'sem vinculo em admin_empresas');
  assert.deepStrictEqual(vinc.params, [77, 5, 'owner']);
});

test('Admin.create sem empresa_id nao tenta vincular', async () => {
  chamadas.length = 0;
  await Admin.create('adm@x.com', 'hash', null, 'operator');
  assert.ok(!chamadas.some((c) => /admin_empresas/.test(c.sql)));
});
