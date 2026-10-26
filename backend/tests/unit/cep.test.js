// Consulta de CEP (BrasilAPI mockada) para preencher o endereco no cadastro.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');

function comAxios(get) {
  const file = require.resolve('axios', { paths: [ROOT] });
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = { get }; require.cache[file] = m;
  delete require.cache[require.resolve(path.join(ROOT, 'src/utils/cepClient.js'))];
  return require(path.join(ROOT, 'src/utils/cepClient.js'));
}

test('consultarCep normaliza a resposta da BrasilAPI', async () => {
  const { consultarCep } = comAxios(async (url) => {
    assert.ok(url.endsWith('/68000000'));
    return { data: { cep: '68000000', state: 'pa', city: 'Santarem', neighborhood: 'Centro', street: 'Rua das Flores' } };
  });
  assert.deepStrictEqual(await consultarCep('68.000-000'), { cep: '68000-000', logradouro: 'Rua das Flores', bairro: 'Centro', cidade: 'Santarem', uf: 'PA' });
});

test('consultarCep: invalido nao chama a API; 404 e falhas viram mensagens seguras', async () => {
  let chamadas = 0;
  let c = comAxios(async () => { chamadas++; return { data: {} }; });
  await assert.rejects(c.consultarCep('123'), (e) => e.status === 400 && e.message === 'CEP inválido');
  assert.strictEqual(chamadas, 0);
  c = comAxios(async () => { const e = new Error('x'); e.response = { status: 404, data: 'segredo' }; throw e; });
  await assert.rejects(c.consultarCep('68000000'), (e) => e.status === 404 && e.message === 'CEP não encontrado');
  c = comAxios(async () => { throw new Error('ETIMEDOUT segredo'); });
  await assert.rejects(c.consultarCep('68000000'), (e) => e.status === 502 && !/segredo/.test(e.message));
});

test('CEP sem logradouro (CEP geral da cidade) devolve so cidade e UF', async () => {
  const c = comAxios(async () => ({ data: { cep: '68000000', state: 'PA', city: 'Santarem' } }));
  const r = await c.consultarCep('68000000');
  assert.strictEqual(r.logradouro, null);
  assert.strictEqual(r.bairro, null);
  assert.strictEqual(r.cidade, 'Santarem');
  assert.strictEqual(r.uf, 'PA');
});
