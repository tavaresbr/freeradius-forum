const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado: registra as consultas e devolve o que o teste configurar.
const chamadas = [];
let proximaLinha = null;
let linhasPorSql = {};
const fakeDb = {
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM mikrotiks/.test(sql)) return [[linhasPorSql.mikrotik]];
    if (/FROM leads/.test(sql)) return [[proximaLinha]];
    return [{ affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const { validarCPF } = require('../../src/utils/cpf');
const { normalizarDataNascimento } = require('../../src/utils/dataNascimento');
const { mascararNome } = require('../../src/utils/mascararDados');
const { buscarCadastroPorCpf, gravarDataNascimento, mesmoDispositivo } = require('../../src/utils/leadUtils');
const { consultaCpf } = require('../../src/controllers/lgpdController');

const CPF_OK = '529.982.247-25';

function resFalso() {
  const r = { statusCode: 200, corpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.corpo = o; return r; };
  return r;
}
function reset() { chamadas.length = 0; proximaLinha = null; linhasPorSql = { mikrotik: { empresa_id: 7 } }; }

test('validarCPF', () => {
  assert.strictEqual(validarCPF(CPF_OK), true);
  assert.strictEqual(validarCPF('52998224725'), true);
  assert.strictEqual(validarCPF('529.982.247-24'), false);
  assert.strictEqual(validarCPF('111.111.111-11'), false);
  assert.strictEqual(validarCPF('123'), false);
  assert.strictEqual(validarCPF(undefined), false);
});

test('normalizarDataNascimento', () => {
  const agora = new Date('2026-10-24T12:00:00Z');
  assert.strictEqual(normalizarDataNascimento('1990-05-17', agora), '1990-05-17');
  assert.strictEqual(normalizarDataNascimento('17/05/1990', agora), '1990-05-17');
  assert.strictEqual(normalizarDataNascimento('2026-10-24', agora), '2026-10-24');
  assert.strictEqual(normalizarDataNascimento('2026-10-25', agora), null);   // futura
  assert.strictEqual(normalizarDataNascimento('31/02/1990', agora), null);   // dia inexistente
  assert.strictEqual(normalizarDataNascimento('1899-12-31', agora), null);   // antes de 1900
  assert.strictEqual(normalizarDataNascimento("1990-05-17'; DROP", agora), null);
  assert.strictEqual(normalizarDataNascimento(19900517, agora), null);
});

test('mascararNome', () => {
  assert.strictEqual(mascararNome('João da Silva'), 'Jo** da Si***');
  assert.strictEqual(mascararNome('  Ana   de  Souza '), 'An* de So***');
  assert.strictEqual(mascararNome(''), '');
  assert.strictEqual(mascararNome(null), '');
});

test('buscarCadastroPorCpf: exige empresa, data e CPF de 11 digitos e consulta com parametros', async () => {
  reset();
  assert.strictEqual(await buscarCadastroPorCpf(CPF_OK, '1990-05-17', null), null);
  assert.strictEqual(await buscarCadastroPorCpf(CPF_OK, null, 7), null);
  assert.strictEqual(await buscarCadastroPorCpf('123', '1990-05-17', 7), null);
  assert.strictEqual(chamadas.length, 0);   // nem chegou ao banco
  proximaLinha = { nome: 'João da Silva', telefone: '11999990000' };
  const r = await buscarCadastroPorCpf(CPF_OK, '1990-05-17', 7);
  assert.deepStrictEqual(r, proximaLinha);
  assert.deepStrictEqual(chamadas[0].params, ['52998224725', 7, '1990-05-17']);
  assert.match(chamadas[0].sql, /empresa_id = \? AND data_nascimento = \?/);
});

test('gravarDataNascimento: nunca sobrescreve e, por padrao, so em lead recem-criado', async () => {
  reset();
  await gravarDataNascimento(CPF_OK, 7, '17/05/1990');
  assert.match(chamadas[0].sql, /data_nascimento IS NULL/);
  assert.match(chamadas[0].sql, /INTERVAL 5 MINUTE/);
  assert.deepStrictEqual(chamadas[0].params, ['1990-05-17', '52998224725', 7]);
  chamadas.length = 0;
  await gravarDataNascimento(CPF_OK, 7, '1990-05-17', { permitirLeadExistente: true });
  assert.match(chamadas[0].sql, /data_nascimento IS NULL/);
  assert.doesNotMatch(chamadas[0].sql, /INTERVAL/);
  chamadas.length = 0;
  await gravarDataNascimento(CPF_OK, 7, 'lixo');            // data invalida: ignora
  await gravarDataNascimento('123', 7, '1990-05-17');        // CPF invalido: ignora
  await gravarDataNascimento(CPF_OK, null, '1990-05-17');    // sem empresa: ignora
  assert.strictEqual(chamadas.length, 0);
});

test('gravarDataNascimento: erro do banco (ex.: sem migration) nao lanca', async () => {
  reset();
  const original = fakeDb.execute;
  fakeDb.execute = async () => { throw new Error("Unknown column 'data_nascimento'"); };
  await assert.doesNotReject(gravarDataNascimento(CPF_OK, 7, '1990-05-17'));
  fakeDb.execute = original;
});

test('mesmoDispositivo compara MAC ignorando formato', () => {
  assert.strictEqual(mesmoDispositivo({ mac: 'AA:BB:CC:DD:EE:FF' }, 'aa-bb-cc-dd-ee-ff'), true);
  assert.strictEqual(mesmoDispositivo({ mac: 'AA:BB:CC:DD:EE:FF' }, '11:22:33:44:55:66'), false);
  assert.strictEqual(mesmoDispositivo({ mac: null }, 'aa-bb-cc-dd-ee-ff'), false);
  assert.strictEqual(mesmoDispositivo(null, ''), false);
});

test('consultaCpf: entrada invalida da 400', async () => {
  reset();
  for (const body of [{}, { cpf: '123', data_nascimento: '1990-05-17' }, { cpf: CPF_OK }, { cpf: CPF_OK, data_nascimento: '2999-01-01' }, { cpf: 12345678909, data_nascimento: '1990-05-17' }]) {
    const res = resFalso();
    await consultaCpf({ body, ip: '1.2.3.4' }, res);
    assert.strictEqual(res.statusCode, 400);
  }
});

test('consultaCpf: passo 1 devolve so o nome mascarado; confirmar devolve nome e telefone', async () => {
  reset();
  proximaLinha = { nome: 'João da Silva', telefone: '11999990000' };
  const body = { cpf: CPF_OK, data_nascimento: '17/05/1990', mikrotik_id: 3 };
  let res = resFalso();
  await consultaCpf({ body, ip: '1.2.3.4' }, res);
  assert.deepStrictEqual(res.corpo, { encontrado: true, nome_mascarado: 'Jo** da Si***' });
  assert.ok(!JSON.stringify(res.corpo).includes('11999990000'));
  res = resFalso();
  await consultaCpf({ body: { ...body, confirmar: true }, ip: '1.2.3.4' }, res);
  assert.deepStrictEqual(res.corpo, { encontrado: true, nome: 'João da Silva', telefone: '11999990000' });
  res = resFalso();   // "true" em texto nao confirma
  await consultaCpf({ body: { ...body, confirmar: 'true' }, ip: '1.2.3.4' }, res);
  assert.strictEqual(res.corpo.nome, undefined);
});

test('consultaCpf: "nao encontrado" e' + " identico em todos os casos (sem enumeracao)", async () => {
  const body = { cpf: CPF_OK, data_nascimento: '17/05/1990', mikrotik_id: 3 };
  const respostas = [];
  // 1) nada no banco (CPF inexistente, data diferente ou cadastro antigo sem data)
  reset(); proximaLinha = undefined;
  let res = resFalso(); await consultaCpf({ body, ip: '1.2.3.4' }, res); respostas.push(JSON.stringify([res.statusCode, res.corpo]));
  // 2) equipamento sem empresa
  reset(); linhasPorSql = { mikrotik: undefined };
  res = resFalso(); await consultaCpf({ body, ip: '1.2.3.4' }, res); respostas.push(JSON.stringify([res.statusCode, res.corpo]));
  // 3) mikrotik_id ausente
  reset();
  res = resFalso(); await consultaCpf({ body: { ...body, mikrotik_id: undefined }, ip: '1.2.3.4' }, res); respostas.push(JSON.stringify([res.statusCode, res.corpo]));
  // 4) banco sem a coluna (migration nao rodou)
  reset();
  const original = fakeDb.execute;
  fakeDb.execute = async (sql, p) => { if (/FROM leads/.test(sql)) throw new Error('Unknown column'); return original(sql, p); };
  res = resFalso(); await consultaCpf({ body, ip: '1.2.3.4' }, res); respostas.push(JSON.stringify([res.statusCode, res.corpo]));
  fakeDb.execute = original;
  assert.strictEqual(new Set(respostas).size, 1);
  assert.strictEqual(respostas[0], JSON.stringify([200, { encontrado: false }]));
});

test('consultaCpf: usa a empresa do equipamento e nunca loga CPF, nome ou data', async () => {
  reset();
  proximaLinha = { nome: 'João da Silva', telefone: '11999990000' };
  const logs = [];
  const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await consultaCpf({ body: { cpf: CPF_OK, data_nascimento: '17/05/1990', mikrotik_id: 3, confirmar: true }, ip: '1.2.3.4' }, resFalso());
  } finally { console.log = origLog; }
  assert.strictEqual(chamadas.find((c) => /FROM leads/.test(c.sql)).params[1], 7);
  const texto = logs.join('\n');
  for (const proibido of ['52998224725', '529.982', 'João', 'Silva', '1990', '17/05', '11999990000']) assert.ok(!texto.includes(proibido), proibido);
});
