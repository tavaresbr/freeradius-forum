// Exportar clientes como contatos (Google / Outlook / vCard): formato, telefone internacional, dedup e anti-formula.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const { gerarContatos, prepararContatos } = require('../../src/utils/exportarContatos');
const { lerContatosGoogle } = require('../../src/utils/googleContatos');

const ROWS = [
  { nome: 'Maria da Silva', email: 'maria@x.com', telefone: '(93) 99193-5695' },
  { nome: 'Maria Repetida', email: '', telefone: '93991935695' },
  { nome: '=CMD()', email: '', telefone: '(11) 98888-7777' },
  { nome: 'Sem Telefone', email: 'a@b.com', telefone: '123' },
  { nome: '', email: '', telefone: '(11) 97777-6666' },
];

test('prepara: telefone +55, sem repetidos e sem telefone invalido', () => {
  const { contatos, semTelefone } = prepararContatos(ROWS);
  assert.deepStrictEqual(contatos.map((c) => c.telefone), ['+5593991935695', '+5511988887777', '+5511977776666']);
  assert.strictEqual(semTelefone, 1);
  assert.strictEqual(contatos[0].primeiro, 'Maria');
  assert.strictEqual(contatos[0].resto, 'da Silva');
  assert.match(contatos[2].primeiro, /^Cliente 6666$/);
});

test('google e outlook: CSV com cabecalho esperado e anti-formula', () => {
  const g = gerarContatos(ROWS, 'google');
  assert.match(g.conteudo, /First Name,Last Name,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value/);
  assert.ok(g.conteudo.includes('"\'=CMD()"'));
  assert.strictEqual(g.total, 3);
  const o = gerarContatos(ROWS, 'outlook');
  assert.match(o.conteudo, /First Name,Last Name,E-mail Address,Mobile Phone/);
  assert.ok(o.conteudo.includes('"+5593991935695"'));
  assert.match(o.arquivo, /outlook/);
});

test('o proprio importador de contatos le de volta os arquivos gerados (ida e volta)', () => {
  for (const [f, nome] of [['google', 'a.csv'], ['outlook', 'a.csv'], ['vcard', 'a.vcf']]) {
    const { conteudo } = gerarContatos(ROWS, f);
    const { contatos } = lerContatosGoogle(Buffer.from(conteudo, 'utf8'), nome);
    assert.strictEqual(contatos.length, 3, f);
    assert.ok(contatos.some((c) => c.telefone === '5593991935695'), f);
  }
});

test('vcard 3.0: campos, escape e CRLF', () => {
  const v = gerarContatos([{ nome: 'Ana; Lima, Souza', email: 'ana@x.com', telefone: '(11) 98888-7777' }], 'vcard');
  assert.match(v.conteudo, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(v.conteudo, /TEL;TYPE=CELL:\+5511988887777/);
  assert.match(v.conteudo, /EMAIL;TYPE=INTERNET:ana@x\.com/);
  assert.match(v.conteudo, /FN:Ana\; Lima\\, Souza/);
  assert.match(v.conteudo, /END:VCARD\r\n$/);
  assert.strictEqual(gerarContatos([], 'vcard').conteudo, '');
  assert.throws(() => gerarContatos(ROWS, 'xml'));
});

test('exportarContatos: so da empresa do tenant, status validado, formato invalido = 400', async () => {
  const db = criarDb(async () => [ROWS]);
  const c = carregar('src/controllers/leadController.js', {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({}) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {}, normalizarTelefone: require('../../src/services/whatsappNotify').normalizarTelefone },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({}) },
    },
  });
  const res = criarRes();
  await c.exportarContatos(criarReq({ empresa_id: 8, query: { formato: 'google', status: 'novo' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(db.calls[0].params, [8, 'novo']);
  assert.match(db.calls[0].sql, /empresa_id = \?/);
  assert.match(res.headers['Content-Disposition'], /contatos-google\.csv/);
  const r2 = criarRes();
  await c.exportarContatos(criarReq({ empresa_id: 8, query: { formato: 'x' } }), r2);
  assert.strictEqual(r2.statusCode, 400);
  const r3 = criarRes();
  await c.exportarContatos(criarReq({ empresa_id: 8, query: { formato: 'vcard', status: "x' OR 1=1" } }), r3);
  assert.strictEqual(r3.statusCode, 400);
});
