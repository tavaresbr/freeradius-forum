const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2');
const somentePrimitivos = require('../../src/middleware/somentePrimitivos');
const { criarRes } = require('../helpers/mocks');

test('db.js liga stringifyObjects (objeto JSON no lugar de string nao vira condicao SQL)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../db.js'), 'utf8');
  assert.match(src, /stringifyObjects:\s*true/);
});

test('com stringifyObjects, {"username":1} vira texto e nao "`username` = 1"', () => {
  const sql = 'DELETE FROM radcheck WHERE username = ?';
  // (mysql2 antigo expandia o objeto em "`username` = 1"; o atual ja nao, mas a opcao explicita fica.)
  assert.doesNotMatch(mysql.format(sql, [{ username: 1 }], true), /`username`/);
});

test('somentePrimitivos recusa objeto/array no corpo e aceita corpo plano', () => {
  let chamou = false;
  const res = criarRes();
  somentePrimitivos({ body: { mac: { username: 1 } } }, res, () => { chamou = true; });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(chamou, false);

  const res2 = criarRes();
  somentePrimitivos({ body: { mac: 'AA:BB', lista: [1] } }, res2, () => { chamou = true; });
  assert.strictEqual(res2.statusCode, 400);

  chamou = false;
  somentePrimitivos({ body: { mac: 'AA:BB', n: 3, ok: true, vazio: null } }, criarRes(), () => { chamou = true; });
  assert.strictEqual(chamou, true);
});
