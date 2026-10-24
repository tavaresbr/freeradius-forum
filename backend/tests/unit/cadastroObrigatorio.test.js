const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado para o controller
const chamadas = [];
let atual = null;
const fakeDb = {
  query: async () => [[]],
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/^\s*SELECT .* FROM leads WHERE id/.test(sql)) return [atual ? [atual] : []];
    if (/FROM leads WHERE REPLACE/.test(sql)) return [[]];
    if (/^\s*INSERT/.test(sql)) return [{ insertId: 5 }];
    return [{ affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const { camposFaltando, mensagemFaltando } = require('../../src/utils/cadastroObrigatorio');
const ctrl = require('../../src/controllers/leadController');

const completo = { nome: 'Ana', cpf: '52998224725', email: 'a@b.com', telefone: '(93) 99999-0000', data_nascimento: '1990-05-17' };
const res = () => { const r = { statusCode: 200, corpo: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.corpo = o; return r; }; return r; };

test('camposFaltando: PF exige CPF, PJ exige CNPJ, vazios e espacos contam', () => {
  assert.deepStrictEqual(camposFaltando(completo), []);
  assert.deepStrictEqual(camposFaltando({}), ['Nome', 'CPF', 'E-mail', 'Data de nascimento', 'Telefone']);
  assert.deepStrictEqual(camposFaltando({ ...completo, cpf: null, cnpj: '11222333000181', tipo_pessoa: 'PJ' }), []);
  assert.deepStrictEqual(camposFaltando({ ...completo, cpf: '529', cnpj: null, tipo_pessoa: 'PJ' }), ['CNPJ']);
  assert.deepStrictEqual(camposFaltando({ ...completo, nome: '   ', email: '' }), ['Nome', 'E-mail']);
  assert.match(mensagemFaltando(['Nome', 'CPF']), /obrigatórios: Nome, CPF/);
});

test('criarLead: recusa sem obrigatorios e cria com todos', async () => {
  chamadas.length = 0;
  let r = res();
  await ctrl.criarLead({ empresa_id: 1, body: { nome: 'Ana', cpf: '529.982.247-25' } }, r);
  assert.strictEqual(r.statusCode, 400);
  assert.deepStrictEqual(r.corpo.campos, ['E-mail', 'Data de nascimento', 'Telefone']);
  assert.ok(!chamadas.some((c) => /INSERT/.test(c.sql)));
  r = res();
  await ctrl.criarLead({ empresa_id: 1, body: { ...completo, cpf: '529.982.247-25', data_nascimento: '17/05/1990', telefone: '93999990000' } }, r);
  assert.strictEqual(r.statusCode, 201);
});

test('atualizarLead: troca de status passa; edicao que esvazia obrigatorio e recusada', async () => {
  chamadas.length = 0;
  atual = { ...completo, cnpj: null, tipo_pessoa: 'PF' };
  let r = res();
  await ctrl.atualizarLead({ empresa_id: 1, params: { id: '9' }, body: { status: 'contactado' } }, r);
  assert.strictEqual(r.statusCode, 200);           // so status: nao exige nada
  r = res();
  await ctrl.atualizarLead({ empresa_id: 1, params: { id: '9' }, body: { email: '' } }, r);
  assert.strictEqual(r.statusCode, 400);
  assert.deepStrictEqual(r.corpo.campos, ['E-mail']);
  r = res();
  await ctrl.atualizarLead({ empresa_id: 1, params: { id: '9' }, body: { nome: 'Ana Maria' } }, r);
  assert.strictEqual(r.statusCode, 200);           // mantem os demais ja preenchidos
  // lead legado incompleto: editar o nome exige completar o resto
  atual = { nome: 'Antigo', cpf: '52998224725', cnpj: null, tipo_pessoa: 'PF', email: null, telefone: null, data_nascimento: null };
  r = res();
  await ctrl.atualizarLead({ empresa_id: 1, params: { id: '9' }, body: { nome: 'Antigo S' } }, r);
  assert.strictEqual(r.statusCode, 400);
  assert.deepStrictEqual(r.corpo.campos, ['E-mail', 'Data de nascimento', 'Telefone']);
});
