const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const v = require('../../src/utils/campanhaValidacao');

test('link: so http(s); javascript:/data: e invalidos sao recusados; vazio limpa', () => {
  assert.deepStrictEqual(v.validarLink('https://exemplo.com/a?b=1'), { ok: true, valor: 'https://exemplo.com/a?b=1' });
  assert.strictEqual(v.validarLink('javascript:alert(1)').ok, false);
  assert.strictEqual(v.validarLink('JaVaScRiPt:alert(1)').ok, false);
  assert.strictEqual(v.validarLink('data:text/html,<script>').ok, false);
  assert.strictEqual(v.validarLink('exemplo.com').ok, false);
  assert.strictEqual(v.validarLink('https://x.com/' + 'a'.repeat(500)).ok, false);
  assert.deepStrictEqual(v.validarLink(''), { ok: true, valor: null });
  assert.deepStrictEqual(v.validarLink(null), { ok: true, valor: null });
});

test('duracao: inteiro de 1 a 60; vazio usa o padrao so quando informado', () => {
  assert.strictEqual(v.validarDuracao('10').valor, 10);
  for (const ruim of ['0', '-3', '61', '1.5', 'abc', 'NaN']) assert.strictEqual(v.validarDuracao(ruim).ok, false, ruim);
  assert.strictEqual(v.validarDuracao(undefined, { padrao: 5 }).valor, 5);
  assert.strictEqual(v.validarDuracao(undefined).ok, false);
});

test('nome obrigatorio e limites de tamanho', () => {
  assert.strictEqual(v.validarNome('  ').ok, false);
  assert.strictEqual(v.validarNome(null).ok, false);
  assert.strictEqual(v.validarNome('a'.repeat(151)).ok, false);
  assert.strictEqual(v.validarNome(' Promo ').valor, 'Promo');
  assert.deepStrictEqual(v.validarTitulo(''), { ok: true, valor: null });
  assert.strictEqual(v.validarTitulo('a'.repeat(151)).ok, false);
});

test('assinatura (magic bytes) confere com o tipo declarado', () => {
  const pad = (b) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
  const jpg = pad([0xff, 0xd8, 0xff, 0xe0]);
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)]);
  const webm = pad([0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(v.assinaturaConfere(jpg, 'image/jpeg'));
  assert.ok(v.assinaturaConfere(png, 'image/png'));
  assert.ok(v.assinaturaConfere(webp, 'image/webp'));
  assert.ok(v.assinaturaConfere(mp4, 'video/mp4'));
  assert.ok(v.assinaturaConfere(webm, 'video/webm'));
  // arquivo qualquer (ex.: HTML/script) dizendo ser imagem
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.ok(!v.assinaturaConfere(html, 'image/png'));
  assert.ok(!v.assinaturaConfere(png, 'image/jpeg'));
  assert.ok(!v.assinaturaConfere(jpg, 'video/mp4'));
  assert.ok(!v.assinaturaConfere(Buffer.alloc(4), 'image/png'));
});

test('arquivoConfere le o inicio do arquivo em disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-'));
  const ok = path.join(dir, 'a.jpg');
  const ruim = path.join(dir, 'b.jpg');
  fs.writeFileSync(ok, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]));
  fs.writeFileSync(ruim, '<?php echo 1; ?> aaaaaaaaaaaaaaaaaaaa');
  assert.ok(v.arquivoConfere(ok, 'image/jpeg'));
  assert.ok(!v.arquivoConfere(ruim, 'image/jpeg'));
  assert.ok(!v.arquivoConfere(path.join(dir, 'nao-existe.jpg'), 'image/jpeg'));
  fs.rmSync(dir, { recursive: true, force: true });
});
