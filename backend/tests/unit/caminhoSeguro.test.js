const test = require('node:test');
const assert = require('node:assert');
const { idSeguro, resolverArquivoUpdate } = require('../../src/utils/caminhoSeguro');
const { assinaturaConfere } = require('../../src/utils/campanhaValidacao');

test('idSeguro aceita ids normais e recusa traversal/shell', () => {
  for (const ok of ['20261026-01', 'v1.2.3', '42', 'manual_1']) assert.strictEqual(idSeguro(ok), ok);
  for (const ruim of ['../x', 'a/b', 'a;rm -rf', '', null, '..', 'a b', '$(id)']) assert.strictEqual(idSeguro(ruim), null, String(ruim));
});

test('resolverArquivoUpdate: dentro do projeto ou /etc/freeradius/3.0, nada alem', () => {
  const root = '/var/www/hotspot';
  assert.strictEqual(resolverArquivoUpdate(root, 'backend/src/a.js').filePath, '/var/www/hotspot/backend/src/a.js');
  assert.deepStrictEqual(resolverArquivoUpdate(root, 'external:/etc/freeradius/3.0/dictionary'), { filePath: '/etc/freeradius/3.0/dictionary', isExternal: true });
  for (const ruim of ['../../etc/passwd', '/etc/passwd', 'backend/../../etc/x', 'external:/etc/passwd', 'external:/etc/freeradius/3.0/../../shadow',
    'backend/.env', '.env', 'backend/certificados/a.pem', 'backend/tokens/t', 'frontend/node_modules/x', '.git/config', '']) {
    assert.throws(() => resolverArquivoUpdate(root, ruim), undefined, ruim);
  }
});

test('assinaturaConfere reconhece GIF e recusa conteudo falso', () => {
  assert.strictEqual(assinaturaConfere(Buffer.from('GIF89a000000000000'), 'image/gif'), true);
  assert.strictEqual(assinaturaConfere(Buffer.from('<svg xmlns=...></svg>'), 'image/gif'), false);
  assert.strictEqual(assinaturaConfere(Buffer.from('<script>alert(1)</script>'), 'image/png'), false);
});
