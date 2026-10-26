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

// Campos obrigatorios (so Complemento e' opcional) para os testes que precisam salvar
const COMPLETO = { telefone: '93991935695', razao_social: 'Acme Ltda', nome_fantasia: 'Acme', cep: '68000000', logradouro: 'Rua X', numero: '1', bairro: 'Centro', cidade: 'Santarem', uf: 'pa' };

test('criarEmpresa grava CNPJ so com digitos e os campos de endereco', async () => {
  const db = criarDb(async (sql) => (/INSERT INTO empresas/.test(sql) ? [{ insertId: 9 }] : undefined));
  const res = criarRes();
  await ctrlEmpresa(db).criarEmpresa(criarReq({ body: { nome: 'Acme', email: 'a@b.com', cnpj: CNPJ_OK, ...COMPLETO } }), res);
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

test('CNPJ duplicado: criar e editar (outra empresa) recusam com 409; a propria empresa pode salvar', async () => {
  const mk = (duplicado) => criarDb(async (sql, params) => {
    if (/FROM empresas\s+WHERE REPLACE/.test(sql)) return [duplicado(sql, params) ? [{ id: 5 }] : []];
    if (/INSERT INTO empresas/.test(sql)) return [{ insertId: 9 }];
    return undefined;
  });
  const corpo = { nome: 'Acme', email: 'a@b.com', cnpj: CNPJ_OK, ...COMPLETO };

  let db = mk(() => true);
  let res = criarRes();
  await ctrlEmpresa(db).criarEmpresa(criarReq({ body: corpo }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!db.calls.some((c) => /INSERT INTO empresas/.test(c.sql)));

  db = mk(() => true);
  res = criarRes();
  await ctrlEmpresa(db).atualizarEmpresa(criarReq({ params: { id: 7 }, body: corpo }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!db.calls.some((c) => /UPDATE empresas/.test(c.sql)));

  // editando a propria empresa: a consulta exclui o proprio id (id <> ?) e nao acha outra
  db = mk((sql, params) => /id <> \?/.test(sql) && params.includes(7) ? false : true);
  res = criarRes();
  await ctrlEmpresa(db).atualizarEmpresa(criarReq({ params: { id: 7 }, body: corpo }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(db.calls.some((c) => /UPDATE empresas/.test(c.sql)));
});

// ---- Conta de pessoa fisica (CPF) ----
const CPF_OK = '529.982.247-25';

test('sanitizarEmpresa PF: exige CPF valido, grava so digitos e ignora CNPJ/razao social', () => {
  const { sanitizarEmpresa } = require(path.join(ROOT, 'src/utils/empresaCadastro.js'));
  assert.strictEqual(sanitizarEmpresa({ tipo_pessoa: 'PF', cpf: '111.111.111-11' }).erro, 'CPF inválido');
  assert.strictEqual(sanitizarEmpresa({ tipo_pessoa: 'PF', cpf: '' }).erro, 'CPF inválido');
  const { dados } = sanitizarEmpresa({ tipo_pessoa: 'PF', cpf: CPF_OK, cnpj: CNPJ_OK, razao_social: 'X LTDA', nome_fantasia: 'X' });
  assert.strictEqual(dados.tipo_pessoa, 'PF');
  assert.strictEqual(dados.cpf, '52998224725');
  assert.strictEqual(dados.cnpj, null);
  assert.strictEqual(dados.razao_social, null);
  assert.strictEqual(dados.nome_fantasia, null);
  // PJ continua como antes (sem CPF)
  const pj = sanitizarEmpresa({ cnpj: CNPJ_OK, cpf: CPF_OK }).dados;
  assert.strictEqual(pj.tipo_pessoa, 'PJ');
  assert.strictEqual(pj.cpf, null);
  assert.strictEqual(pj.cnpj, '11222333000181');
});

test('criarEmpresa PF grava tipo_pessoa e CPF; CPF invalido e duplicado recusam sem gravar', async () => {
  const restaura = silencia();
  try {
    let db = criarDb(async (sql) => (/INSERT INTO empresas/.test(sql) ? [{ insertId: 9 }] : undefined));
    let res = criarRes();
    await ctrlEmpresa(db).criarEmpresa(criarReq({ body: { nome: 'Joao', email: 'j@b.com', tipo_pessoa: 'PF', cpf: CPF_OK, ...COMPLETO } }), res);
    assert.strictEqual(res.statusCode, 201);
    const ins = db.calls.find((c) => /INSERT INTO empresas/.test(c.sql));
    assert.ok(ins.params.includes('PF') && ins.params.includes('52998224725'));

    db = criarDb();
    res = criarRes();
    await ctrlEmpresa(db).criarEmpresa(criarReq({ body: { nome: 'Joao', email: 'j@b.com', tipo_pessoa: 'PF', cpf: '12345678900' } }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(!db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)));

    const dup = (sql) => (/tipo_pessoa = 'PF' AND cpf = \?/.test(sql) ? [[{ id: 5 }]] : undefined);
    db = criarDb(dup);
    res = criarRes();
    await ctrlEmpresa(db).criarEmpresa(criarReq({ body: { nome: 'Joao', email: 'j@b.com', tipo_pessoa: 'PF', cpf: CPF_OK, ...COMPLETO } }), res);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(!db.calls.some((c) => /INSERT INTO empresas/.test(c.sql)));

    db = criarDb(dup);
    res = criarRes();
    await ctrlEmpresa(db).atualizarEmpresa(criarReq({ params: { id: 7 }, body: { nome: 'Joao', email: 'j@b.com', tipo_pessoa: 'PF', cpf: CPF_OK, ...COMPLETO } }), res);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(!db.calls.some((c) => /UPDATE empresas/.test(c.sql)));
  } finally { restaura(); }
});

test('sanitizarEmpresa exigirCompleto: lista o que falta; Complemento e dados de PJ so em PJ', () => {
  const { sanitizarEmpresa } = require(path.join(ROOT, 'src/utils/empresaCadastro.js'));
  const vazio = sanitizarEmpresa({ cnpj: CNPJ_OK }, { exigirCompleto: true });
  assert.match(vazio.erro, /^Preencha todos os campos obrigatórios: /);
  for (const rotulo of ['Razão social', 'Nome fantasia', 'CEP', 'Endereço', 'Número', 'Bairro', 'Cidade', 'UF', 'Telefone']) assert.ok(vazio.erro.includes(rotulo), rotulo);
  assert.ok(!vazio.erro.includes('CNPJ,') && !vazio.erro.includes('Complemento'));
  assert.match(sanitizarEmpresa({ ...COMPLETO }, { exigirCompleto: true }).erro, /CNPJ/);
  assert.ok(sanitizarEmpresa({ cnpj: CNPJ_OK, ...COMPLETO }, { exigirCompleto: true }).dados);
  // PF: sem razao social/nome fantasia/CNPJ, mas com CPF e endereco completos
  const { razao_social, nome_fantasia, ...semPJ } = COMPLETO;
  assert.ok(sanitizarEmpresa({ tipo_pessoa: 'PF', cpf: CPF_OK, ...semPJ }, { exigirCompleto: true }).dados);
  assert.match(sanitizarEmpresa({ tipo_pessoa: 'PF', cpf: CPF_OK, ...semPJ, numero: '' }, { exigirCompleto: true }).erro, /Número/);
  // sem a flag, o comportamento antigo (tudo opcional) continua
  assert.ok(sanitizarEmpresa({ cnpj: CNPJ_OK }).dados);
});

test('criarEmpresa e atualizarEmpresa recusam cadastro incompleto com 400 sem gravar', async () => {
  const restaura = silencia();
  try {
    for (const fn of ['criarEmpresa', 'atualizarEmpresa']) {
      const db = criarDb();
      const res = criarRes();
      await ctrlEmpresa(db)[fn](criarReq({ params: { id: 1 }, body: { nome: 'Acme', email: 'a@b.com', cnpj: CNPJ_OK } }), res);
      assert.strictEqual(res.statusCode, 400, fn);
      assert.match(res.body.message, /Preencha todos os campos obrigatórios/);
      assert.ok(!db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)), fn);
    }
  } finally { restaura(); }
});
