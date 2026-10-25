// Consulta de CNPJ (BrasilAPI mockada) e gravacao do cadastro completo da empresa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const CNPJ_OK = '11.222.333/0001-81';
const silencia = () => { const e = console.error; console.error = () => {}; return () => { console.error = e; }; };

function comAxios(get) {
  const file = require.resolve('axios', { paths: [ROOT] });
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = { get }; require.cache[file] = m;
  delete require.cache[require.resolve(path.join(ROOT, 'src/utils/cnpjClient.js'))];
  return require(path.join(ROOT, 'src/utils/cnpjClient.js'));
}

test('validarCNPJ confere digitos verificadores', () => {
  const { validarCNPJ } = comAxios(async () => ({}));
  assert.strictEqual(validarCNPJ(CNPJ_OK), true);
  assert.strictEqual(validarCNPJ('11.222.333/0001-82'), false);
  assert.strictEqual(validarCNPJ('00000000000000'), false);
  assert.strictEqual(validarCNPJ('123'), false);
});

test('consultarCnpj normaliza a resposta da BrasilAPI', async () => {
  const { consultarCnpj } = comAxios(async (url) => {
    assert.ok(url.endsWith('/11222333000181'));
    return { data: { razao_social: 'ACME LTDA', nome_fantasia: 'Acme', email: 'CONTATO@ACME.COM', ddd_telefone_1: '9333334444', cep: '68000000', descricao_tipo_de_logradouro: 'RUA', logradouro: 'DAS FLORES', numero: '10', complemento: 'SALA 2', bairro: 'CENTRO', municipio: 'SANTAREM', uf: 'pa' } };
  });
  const r = await consultarCnpj(CNPJ_OK);
  assert.deepStrictEqual(r, { cnpj: '11222333000181', razao_social: 'ACME LTDA', nome_fantasia: 'Acme', email: 'contato@acme.com', telefone: '(93) 3333-4444', cep: '68000-000', logradouro: 'RUA DAS FLORES', numero: '10', complemento: 'SALA 2', bairro: 'CENTRO', cidade: 'SANTAREM', uf: 'PA' });
});

test('consultarCnpj: invalido nao chama a API; 404 e falhas viram mensagens seguras', async () => {
  let chamadas = 0;
  let c = comAxios(async () => { chamadas++; return { data: {} }; });
  await assert.rejects(c.consultarCnpj('123'), (e) => e.status === 400);
  assert.strictEqual(chamadas, 0);
  c = comAxios(async () => { const e = new Error('x'); e.response = { status: 404, data: 'segredo' }; throw e; });
  await assert.rejects(c.consultarCnpj(CNPJ_OK), (e) => e.status === 404 && e.message === 'CNPJ não encontrado');
  c = comAxios(async () => { throw new Error('ETIMEDOUT segredo'); });
  await assert.rejects(c.consultarCnpj(CNPJ_OK), (e) => e.status === 502 && !/segredo/.test(e.message));
});

function ctrlEmpresa(db) {
  return carregar('src/controllers/empresaController.js', {
    db,
    extras: {
      'src/utils/empresaSetup.js': { criarPortaisPadrao: async () => {}, criarPlanosPadrao: async () => {} },
      'src/utils/assinatura.js': { criarTrial: async () => {} },
      'src/utils/perfis.js': { atribuirPerfil: async () => {}, perfilDoAdmin: async () => null },
    },
  });
}

test('criarEmpresa grava CNPJ so com digitos e os campos de endereco', async () => {
  const db = criarDb(async (sql) => (/INSERT INTO empresas/.test(sql) ? [{ insertId: 9 }] : undefined));
  const res = criarRes();
  await ctrlEmpresa(db).criarEmpresa(criarReq({ body: { nome: 'Acme', email: 'a@b.com', cnpj: CNPJ_OK, telefone: '93991935695', cep: '68000000', logradouro: 'Rua X', numero: '1', cidade: 'Santarem', uf: 'pa' } }), res);
  assert.strictEqual(res.statusCode, 201);
  const ins = db.calls.find((c) => /INSERT INTO empresas/.test(c.sql));
  assert.ok(ins.params.includes('11222333000181'));
  assert.ok(ins.params.includes('(93) 99193-5695'));
  assert.ok(ins.params.includes('68000-000'));
  assert.ok(ins.params.includes('PA'));
});

test('criarEmpresa e atualizarEmpresa recusam CNPJ invalido sem gravar', async () => {
  const restaura = silencia();
  try {
    for (const fn of ['criarEmpresa', 'atualizarEmpresa']) {
      const db = criarDb();
      const res = criarRes();
      await ctrlEmpresa(db)[fn](criarReq({ params: { id: 1 }, body: { nome: 'Acme', email: 'a@b.com', cnpj: '11222333000182' } }), res);
      assert.strictEqual(res.statusCode, 400, fn);
      assert.ok(!db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)), fn);
    }
  } finally { restaura(); }
});
