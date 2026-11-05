const test = require('node:test');
const assert = require('node:assert');
const IntelbrasDriver = require('../../src/gateways/IntelbrasDriver');
const { detectPortalVendor } = require('../../src/utils/portalVendor');
const { montarLoginIntelbras, continuarUrl } = require('../../src/gateways/intelbrasLogin');
const { calcularTrilha } = require('../../src/utils/trilhaAtivacao');

test('IntelbrasDriver: teste de conexao ok, sem desconexao ativa nem sessoes', async () => {
  const d = new IntelbrasDriver({ tipo: 'intelbras', id: 1, ip: '10.8.0.9' });
  const r = await d.testConnection();
  assert.equal(r.sucesso, true);
  const rev = await d.revoke();
  assert.equal(rev.success, false);
  assert.deepEqual(await d.getActiveSessions(), []);
});

// Query REAL enviada por um AP 1350 AC-S (Zeus OS 4.4.132) ao /hotspot/redirect/29.
const QUERY_AP = {
  continue: 'neverssl.com/',
  auth_service: '1',
  ip: '10.0.0.1',
  mac: 'D6:B2:48:79:F0:FA',
  ap_mac: '98:2A:0A:59:BA:AF',
  radio: 'wifi1',
  ssid: 'AP1350AC-S_baaf',
  ts: '1793909859',
  redirect_uri: 'https://meucaptive.intelbras.com.br:2061/cp/itbcaptive.cgi',
  user_hash: '7e23bada3fcff90de7784c4c175d991d',
};

test('portalVendor: intelbras le a query real do AP (ip e do AP, nao do cliente)', () => {
  const ctx = detectPortalVendor(QUERY_AP, { tipo: 'intelbras' });
  assert.equal(ctx.vendor, 'intelbras');
  assert.equal(ctx.mac, 'D6:B2:48:79:F0:FA');
  assert.equal(ctx.ip, null);
  assert.equal(ctx.apIp, '10.0.0.1');
  assert.equal(ctx.apMac, '98:2A:0A:59:BA:AF');
  assert.equal(ctx.ssid, 'AP1350AC-S_baaf');
  assert.equal(ctx.redirectUrl, 'neverssl.com/');
  assert.equal(ctx.raw.redirect_uri, QUERY_AP.redirect_uri);
});

test('portalVendor: detecta intelbras so pelos parametros e nao confunde com grandstream', () => {
  assert.equal(detectPortalVendor(QUERY_AP).vendor, 'intelbras');
  assert.equal(detectPortalVendor({ login_url: 'http://x/login', client_mac: 'AA:BB:CC:DD:EE:FF' }).vendor, 'grandstream');
});

test('intelbrasLogin: monta o retorno ao AP com user_hash e continue completo', () => {
  const ctx = detectPortalVendor(QUERY_AP, { tipo: 'intelbras' });
  const login = montarLoginIntelbras(ctx, { ip: '10.8.0.16' });
  assert.deepEqual(login, {
    url: 'https://meucaptive.intelbras.com.br:2061/cp/itbcaptive.cgi',
    user_hash: '7e23bada3fcff90de7784c4c175d991d',
    continue: 'http://neverssl.com/',
  });
});

test('intelbrasLogin: aceita o AP por IP da rede local e rejeita host de terceiro', () => {
  const gw = { ip: '10.8.0.16' };
  const mk = (uri) => montarLoginIntelbras({ raw: { ...QUERY_AP, redirect_uri: uri } }, gw);
  assert.ok(mk('http://10.0.0.1:2061/cp/itbcaptive.cgi'));
  assert.equal(mk('https://atacante.example.com:2061/cp/itbcaptive.cgi'), null); // credencial nao vai a terceiro
  assert.equal(mk('https://meucaptive.intelbras.com.br.atacante.com:2061/cp/itbcaptive.cgi'), null);
  assert.equal(mk('https://meucaptive.intelbras.com.br:2061/outro/caminho'), null);
  assert.equal(mk('https://meucaptive.intelbras.com.br:8443/cp/itbcaptive.cgi'), null);
  assert.equal(mk('https://u:p@meucaptive.intelbras.com.br:2061/cp/itbcaptive.cgi'), null);
  assert.equal(mk('javascript:alert(1)'), null);
});

test('intelbrasLogin: sem user_hash valido ou sem contexto nao monta o login', () => {
  const sem = { raw: { ...QUERY_AP, user_hash: '' } };
  assert.equal(montarLoginIntelbras(sem, {}), null);
  assert.equal(montarLoginIntelbras({ raw: { ...QUERY_AP, user_hash: 'a&b=c' } }, {}), null);
  assert.equal(montarLoginIntelbras(null, {}), null);
});

test('intelbrasLogin: continue vazio ou invalido cai no fallback', () => {
  assert.equal(continuarUrl(''), 'http://neverssl.com');
  assert.equal(continuarUrl('javascript:alert(1)'), 'http://neverssl.com');
  assert.equal(continuarUrl('https://www.intelbras.com.br'), 'https://www.intelbras.com.br/');
});

test('trilha: intelbras usa RADIUS e aponta o tutorial na etapa de hotspot', () => {
  const t = calcularTrilha(
    { id: 7, nome: 'AP', ip: '10.8.0.9', tipo: 'intelbras', portal_id: null, end_hotspot: null },
    { nas: new Set(), planos: { porEquipamento: new Map(), semEquipamento: 0 }, sessoes: new Map() }
  );
  const radius = t.etapas.find((e) => e.chave === 'radius');
  assert.notEqual(radius.estado, 'na');
  assert.ok(JSON.stringify(t).includes('tutorial-intelbras'));
});
