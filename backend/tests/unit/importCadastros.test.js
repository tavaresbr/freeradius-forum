const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado
const chamadas = [];
let existentes = [];
const fakeDb = {
  query: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return [existentes];
    return [{ affectedRows: 1 }];
  },
  execute: async (sql, params) => { chamadas.push({ sql, params }); return [{ affectedRows: 1 }]; },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const imp = require('../../src/utils/importCadastros');
const sgp = require('../../src/utils/sgpClient');

const CPF1 = '529.982.247-25';
const reset = () => { chamadas.length = 0; existentes = []; };

test('sugerirMapeamento casa cabecalhos com acento e variacoes', () => {
  const m = imp.sugerirMapeamento(['Nome Completo', 'CPF/CNPJ', 'Data de Nascimento', 'E-mail', 'Celular', 'Endereço', 'Município', 'UF', 'CEP', 'Código']);
  assert.strictEqual(m.nome, 'Nome Completo');
  assert.strictEqual(m.cpf, 'CPF/CNPJ');
  assert.strictEqual(m.data_nascimento, 'Data de Nascimento');
  assert.strictEqual(m.email, 'E-mail');
  assert.strictEqual(m.telefone, 'Celular');
  assert.strictEqual(m.logradouro, 'Endereço');
  assert.strictEqual(m.cidade, 'Município');
  assert.strictEqual(m.id_externo, 'Código');
});

test('normalizarDataImport: texto, ISO, Date, serial do Excel e lixo', () => {
  assert.strictEqual(imp.normalizarDataImport('17/05/1990'), '1990-05-17');
  assert.strictEqual(imp.normalizarDataImport('1990-05-17T00:00:00Z'), '1990-05-17');
  assert.strictEqual(imp.normalizarDataImport(new Date('1990-05-17T12:00:00Z')), '1990-05-17');
  assert.strictEqual(imp.normalizarDataImport(33010), '1990-05-17');   // serial Excel
  assert.strictEqual(imp.normalizarDataImport('31/02/1990'), null);
  assert.strictEqual(imp.normalizarDataImport('abc'), null);
  assert.strictEqual(imp.normalizarDataImport(''), null);
});

test('formatarTelefone / formatarCep', () => {
  assert.strictEqual(imp.formatarTelefone('93991935695'), '(93) 99193-5695');
  assert.strictEqual(imp.formatarTelefone('+55 (93) 99193-5695'), '(93) 99193-5695');
  assert.strictEqual(imp.formatarTelefone('9333334444'), '(93) 3333-4444');
  assert.strictEqual(imp.formatarTelefone('123'), null);
  assert.strictEqual(imp.formatarCep('68000000'), '68000-000');
  assert.strictEqual(imp.formatarCep('680'), null);
});

test('normalizarLinha: valida CPF, PJ por CNPJ no campo cpf, avisos nao bloqueiam', () => {
  const map = { nome: 'N', cpf: 'D', email: 'E', telefone: 'T', data_nascimento: 'DN', uf: 'UF' };
  let r = imp.normalizarLinha({ N: 'Maria', D: CPF1, E: 'invalido', T: '12', DN: '99/99/9999', UF: 'pa' }, map);
  assert.strictEqual(r.dados.cpf, '52998224725');
  assert.strictEqual(r.dados.email, null);
  assert.strictEqual(r.dados.uf, 'PA');
  assert.strictEqual(r.avisos.length, 3);
  assert.strictEqual(imp.normalizarLinha({ N: 'X', D: '111.111.111-11' }, map).erro, 'CPF inválido');
  assert.strictEqual(imp.normalizarLinha({ N: '', D: CPF1 }, map).erro, 'Nome vazio');
  assert.strictEqual(imp.normalizarLinha({ N: 'X', D: '' }, map).erro, 'Sem CPF/CNPJ');
  r = imp.normalizarLinha({ N: 'Empresa', D: '11.222.333/0001-81' }, map);
  assert.strictEqual(r.dados.cnpj, '11222333000181');
  assert.strictEqual(r.dados.cpf, null);
  assert.strictEqual(r.dados.tipo_pessoa, 'PJ');
});

test('processarImportacao: novo insere, existente so preenche vazios, duplicado e erro contam', async () => {
  reset();
  existentes = [{ id: 9, cpf_l: '52998224725', cnpj_l: null }];
  const map = { nome: 'N', cpf: 'D' };
  const linhas = [
    { N: 'Existente', D: CPF1 },
    { N: 'Novo', D: '168.995.350-09' },
    { N: 'Novo repetido', D: '16899535009' },
    { N: 'Ruim', D: '123' },
  ];
  const r = await imp.processarImportacao(linhas, map, 7, { sistemaOrigem: 'sgp' });
  assert.deepStrictEqual([r.criados, r.atualizados, r.ignorados, r.erros.length], [1, 1, 1, 1]);
  assert.deepStrictEqual(r.erros[0], { linha: 5, motivo: 'CPF inválido' });

  const ins = chamadas.find((c) => /INSERT INTO leads/.test(c.sql));
  assert.match(ins.sql, /lgpd_aceite\) VALUES \?/);
  const linhaIns = ins.params[0][0];
  assert.strictEqual(linhaIns[0], 7);                       // empresa_id
  assert.ok(linhaIns.includes('sgp') && linhaIns.includes('importacao'));
  assert.strictEqual(linhaIns[linhaIns.length - 1], 0);     // lgpd_aceite sempre 0

  const upd = chamadas.find((c) => /UPDATE leads/.test(c.sql));
  assert.match(upd.sql, /nome = COALESCE\(NULLIF\(nome, ''\), \?\)/);
  assert.match(upd.sql, /data_nascimento = COALESCE\(data_nascimento, \?\)/);
  assert.doesNotMatch(upd.sql, /lgpd_|status|cpf =/);       // nunca toca consentimento/status/CPF
  assert.deepStrictEqual(upd.params.slice(-2), [9, 7]);     // WHERE id = ? AND empresa_id = ?
});

test('processarImportacao: simulacao nao grava e exige empresa', async () => {
  reset();
  const r = await imp.processarImportacao([{ N: 'A', D: CPF1 }], { nome: 'N', cpf: 'D' }, 7, { dryRun: true });
  assert.strictEqual(r.criados, 1);
  assert.ok(!chamadas.some((c) => /INSERT|UPDATE/.test(c.sql)));
  await assert.rejects(imp.processarImportacao([], {}, null));
});

test('parseCsv: delimitador ;, aspas, BOM e linha vazia', () => {
  const csv = '﻿nome;cpf;obs\r\n"Silva; Maria";52998224725;"diz ""oi"""\r\n\r\nJoão;16899535009;\r\n';
  const { cabecalhos, linhas } = imp.parseCsv(Buffer.from(csv, 'utf8'));
  assert.deepStrictEqual(cabecalhos, ['nome', 'cpf', 'obs']);
  assert.strictEqual(linhas.length, 2);
  assert.strictEqual(linhas[0].nome, 'Silva; Maria');
  assert.strictEqual(linhas[0].obs, 'diz "oi"');
  assert.strictEqual(linhas[1].obs, '');
});

test('lerPlanilha le o modelo CSV e o mapeamento automatico acha nome e cpf', async () => {
  const { cabecalhos, linhas } = await imp.lerPlanilha(Buffer.from(imp.MODELO_CSV), 'modelo.csv');
  const m = imp.sugerirMapeamento(cabecalhos);
  assert.ok(m.nome && m.cpf);
  const r = imp.normalizarLinha(linhas[0], m);
  assert.strictEqual(r.dados.cpf, '52998224725');
  assert.strictEqual(r.dados.data_nascimento, '1990-05-17');
  assert.strictEqual(r.dados.telefone, '(93) 99999-0000');
});

test('lerPlanilha le XLSX', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('c');
  ws.addRow(['Nome', 'CPF', 'Nascimento']);
  ws.addRow(['Ana', CPF1, new Date('1985-04-01T12:00:00Z')]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { linhas } = await imp.lerPlanilha(buf, 'a.xlsx');
  const r = imp.normalizarLinha(linhas[0], imp.sugerirMapeamento(['Nome', 'CPF', 'Nascimento']));
  assert.strictEqual(r.dados.data_nascimento, '1985-04-01');
  assert.strictEqual(r.dados.cpf, '52998224725');
});

test('sgpClient: achatar, extrairLista e urlPermitida', () => {
  const plano = sgp.achatar({ id: 5, nome: 'Ana', endereco: { cidade: 'Santarém', uf: 'PA' }, contratos: [{ id: 1 }] });
  assert.strictEqual(plano.endereco_cidade, 'Santarém');
  assert.strictEqual(plano.cidade, 'Santarém');
  assert.strictEqual(plano.contratos, undefined);
  assert.deepStrictEqual(sgp.extrairLista({ clientes: [1] }), [1]);
  assert.deepStrictEqual(sgp.extrairLista([2]), [2]);
  assert.strictEqual(sgp.extrairLista({ x: 1 }), null);
  assert.strictEqual(sgp.urlPermitida('https://sgp.exemplo.com.br'), true);
  for (const u of ['http://localhost:3001', 'http://127.0.0.1', 'http://169.254.169.254/latest', 'ftp://x.com', 'lixo']) {
    assert.strictEqual(sgp.urlPermitida(u), false, u);
  }
});
