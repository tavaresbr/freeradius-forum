const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Garante a regra de isolamento sem subir o servidor: as rotas /minha/logo ficam antes do
// bloqueio de super_admin, exigem tenant + permissao e so usam req.empresa_id.
const src = fs.readFileSync(path.resolve(__dirname, '../../src/routes/empresaRoutes.js'), 'utf8');

test('rotas /minha/logo existem antes do router.use de super_admin', () => {
  const iPost = src.indexOf('router.post("/minha/logo"');
  const iDel = src.indexOf('router.delete("/minha/logo"');
  const iSuper = src.indexOf("router.use(auth, authorize('super_admin')");
  assert.ok(iPost > 0 && iDel > 0 && iSuper > 0);
  assert.ok(iPost < iSuper && iDel < iSuper);
});

test('protecao: auth, tenant, assinatura e permissao configuracoes', () => {
  assert.match(src, /permissaoMinhaLogo = \[auth, tenant, exigeAssinatura, checkPermissao\('configuracoes'\)\]/);
});

test('so usa req.empresa_id (nunca req.params.id) nas rotas /minha', () => {
  const trecho = src.slice(src.indexOf('Logomarca da PROPRIA empresa'), src.indexOf("router.use(auth, authorize('super_admin')"));
  assert.doesNotMatch(trecho, /req\.params/);
  assert.match(trecho, /WHERE id = \?', \[req\.empresa_id\]/);
});

test('apagarLogoAntiga so remove arquivos da propria empresa', () => {
  assert.match(src, /startsWith\(`empresa-\$\{empresaId\}-`\)/);
});
