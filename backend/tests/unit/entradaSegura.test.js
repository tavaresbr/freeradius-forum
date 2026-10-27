const test = require('node:test');
const assert = require('node:assert');
const { carregar, criarDb } = require('../helpers/mocks');
const E = require('../../src/utils/entradaSegura');

test('escapeHtml neutraliza aspas e tags', () => {
  assert.strictEqual(E.escapeHtml('"><script>alert(1)</script>'), '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('mac e ip: so formato valido', () => {
  assert.strictEqual(E.normalizarMac('AA:BB:CC:DD:EE:FF'), 'AA:BB:CC:DD:EE:FF');
  assert.strictEqual(E.normalizarMac('aa-bb-cc-dd-ee-ff'), 'aa-bb-cc-dd-ee-ff');
  assert.strictEqual(E.normalizarMac('";alert(1)//'), '');
  assert.strictEqual(E.normalizarIp('10.0.0.5'), '10.0.0.5');
  assert.strictEqual(E.normalizarIp('1"><img src=x onerror=alert(1)>'), '');
});

test('id e slug', () => {
  assert.strictEqual(E.normalizarId('12'), '12');
  assert.strictEqual(E.normalizarId('1<script>'), null);
  assert.strictEqual(E.normalizarSlug('minha-empresa"<'), 'minha-empresa');
});

test('urlHttpSegura bloqueia javascript: e data:', () => {
  assert.strictEqual(E.urlHttpSegura('javascript:alert(1)'), null);
  assert.strictEqual(E.urlHttpSegura('data:text/html,<script>'), null);
  assert.ok(E.urlHttpSegura('https://exemplo.com/a?b=1'));
});

test('hostPermitidoGateway: gateway cadastrado ou IP local; host externo nao', () => {
  const gw = { ip: '10.8.0.2', controller_url: 'https://ctrl.empresa.com:8043' };
  assert.strictEqual(E.hostPermitidoGateway('10.8.0.2', gw), true);
  assert.strictEqual(E.hostPermitidoGateway('192.168.0.10', gw), true);
  assert.strictEqual(E.hostPermitidoGateway('ctrl.empresa.com', gw), true);
  assert.strictEqual(E.hostPermitidoGateway('atacante.com', gw), false);
  assert.strictEqual(E.hostPermitidoGateway('8.8.8.8', gw), false);
});

test('browserauth do Omada ignora target fora do gateway (credencial nao vai a host do atacante)', () => {
  const { montarBrowserauthOmada } = carregar('src/gateways/gatewayLiberacao.js', {
    db: criarDb(),
    extras: { 'src/gateways/index.js': { getDriver: () => ({}) } },
  });
  const gw = { ip: '10.8.0.2' };
  const ctx = (target, extra = {}) => ({ mac: 'AA:BB:CC:DD:EE:FF', raw: { target, serverPort: '8088', ...extra } });
  assert.strictEqual(montarBrowserauthOmada(ctx('atacante.com'), gw), null);
  const ok = montarBrowserauthOmada(ctx('192.168.0.10', { redirectUrl: 'javascript:alert(1)' }), gw);
  assert.strictEqual(ok.url, 'http://192.168.0.10:8088/portal/radius/browserauth');
  assert.strictEqual(ok.fields.originUrl, undefined);
});

test('urlPortalSegura: aceita caminho relativo do site e http(s); recusa o resto', () => {
  const { urlPortalSegura } = require('../../src/utils/entradaSegura');
  assert.strictEqual(urlPortalSegura('/cadastro'), '/cadastro');
  assert.strictEqual(urlPortalSegura('/planos-cliente?x=1'), '/planos-cliente?x=1');
  assert.ok(urlPortalSegura('https://exemplo.com/p'));
  for (const ruim of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'cadastro', '', null, '/a\nb']) {
    assert.strictEqual(urlPortalSegura(ruim), null, String(ruim));
  }
});
