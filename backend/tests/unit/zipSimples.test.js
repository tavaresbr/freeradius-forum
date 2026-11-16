const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

// Util de frontend (ESM): carregado por import dinamico
const carregar = () => import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/utils/zipSimples.js')).href);

test('criarZipBytes gera um ZIP valido (stored) com nome, conteudo e CRC corretos', async () => {
  const { criarZipBytes } = await carregar();
  const conteudo = '[Interface]\nPrivateKey = abc\nAddress = 10.8.0.9/24\n';
  const buf = Buffer.from(criarZipBytes([{ nome: 'CLIENTE-02.conf', conteudo }], new Date(2026, 10, 16, 12, 30, 40)));

  // cabecalho local
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(buf.readUInt16LE(8), 0); // stored
  const dados = Buffer.from(conteudo, 'utf8');
  assert.strictEqual(buf.readUInt32LE(14), zlib.crc32(dados));
  assert.strictEqual(buf.readUInt32LE(18), dados.length);
  assert.strictEqual(buf.readUInt32LE(22), dados.length);
  const nomeLen = buf.readUInt16LE(26);
  assert.strictEqual(buf.subarray(30, 30 + nomeLen).toString('utf8'), 'CLIENTE-02.conf');
  assert.strictEqual(buf.subarray(30 + nomeLen, 30 + nomeLen + dados.length).toString('utf8'), conteudo);

  // fim do diretorio central: 1 arquivo, aponta para o diretorio central
  const fim = buf.length - 22;
  assert.strictEqual(buf.readUInt32LE(fim), 0x06054b50);
  assert.strictEqual(buf.readUInt16LE(fim + 10), 1);
  const offCentral = buf.readUInt32LE(fim + 16);
  assert.strictEqual(buf.readUInt32LE(offCentral), 0x02014b50);
  assert.strictEqual(buf.readUInt32LE(offCentral + 42), 0); // offset do 1o arquivo
});

test('criarZipBytes com varios arquivos e nomes acentuados (UTF-8)', async () => {
  const { criarZipBytes } = await carregar();
  const buf = Buffer.from(criarZipBytes([{ nome: 'a.conf', conteudo: 'um' }, { nome: 'acentuação.txt', conteudo: 'olá' }]));
  const fim = buf.length - 22;
  assert.strictEqual(buf.readUInt16LE(fim + 10), 2);
  assert.strictEqual(buf.readUInt16LE(6) & 0x0800, 0x0800); // flag UTF-8
  assert.ok(buf.includes(Buffer.from('acentuação.txt', 'utf8')));
});
