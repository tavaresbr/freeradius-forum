const test = require('node:test');
const assert = require('node:assert');
const { descreverErro } = require('../../src/utils/mikrotikClient');

test('descreverErro: mensagem vazia usa errno/code e traduz', () => {
  assert.match(descreverErro({ message: '', errno: 'SOCKTMOUT' }), /Sem resposta/);
  assert.match(descreverErro({ message: '', code: 'ETIMEDOUT' }), /Sem resposta/);
  assert.match(descreverErro({ message: '', code: 'ECONNREFUSED' }), /Conexão recusada/);
  assert.match(descreverErro({ message: '', code: 'EHOSTUNREACH' }), /Sem rota/);
  assert.match(descreverErro({ message: '', code: 'ENOTFOUND' }), /não encontrado/);
});

test('descreverErro: login recusado', () => {
  assert.match(descreverErro({ message: '', errno: 'CANTLOGIN' }), /Usuário ou senha/);
  assert.match(descreverErro({ message: 'Cannot log in' }), /Usuário ou senha/);
});

test('descreverErro: nunca devolve texto vazio', () => {
  assert.ok(descreverErro({ message: '' }).length > 0);
  assert.ok(descreverErro(null).length > 0);
  assert.strictEqual(descreverErro({ message: 'algo novo' }), 'algo novo');
});
