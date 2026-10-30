// Padroes do hotspot (keepalive, interim-update, timeout RADIUS) aplicados a todo MikroTik.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOTSPOT_PADROES } = require('../../src/constants/hotspotDefaults');
const { aplicarPadroesHotspot, configurarWifiAP, ehInterfaceWifi } = require('../../src/utils/hotspotSetup');

function conexaoFalsa({ radius = [{ '.id': '*1', service: 'hotspot' }], falha = {}, naoConecta = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    connect: async () => { if (naoConecta) throw new Error('timeout'); },
    close: async () => {},
    write: async (caminho, args = []) => {
      chamadas.push({ caminho, args });
      if (falha[caminho]) throw new Error(falha[caminho]);
      if (caminho === '/radius/print') return radius;
      return [];
    },
  };
}
const MK = { ip: '10.8.0.3', usuario: 'admin', senha: 'x', porta: 8728 };

test('padroes: valores combinados (keepalive 30m, interim 5m, timeout RADIUS 3s)', () => {
  assert.deepStrictEqual(HOTSPOT_PADROES, { keepaliveTimeout: '30m', idleTimeout: 'none', radiusInterimUpdate: '5m', radiusTimeout: '3s', addressesPerMac: '1', dhcpLeaseTime: '1h', loginBy: 'http-chap,http-pap,mac-cookie', macCookieTimeout: '1h' });
});

test('aplicarPadroesHotspot ajusta hotspot profile, user profile default e cliente RADIUS', async () => {
  const conn = conexaoFalsa();
  const r = await aplicarPadroesHotspot(MK, () => conn);
  assert.strictEqual(r.ok, true);
  const por = Object.fromEntries(conn.chamadas.map((c) => [c.caminho, c.args]));
  assert.ok(por['/ip/hotspot/profile/set'].includes('=radius-interim-update=5m'));
  assert.ok(por['/ip/hotspot/profile/set'].includes('=numbers=hsprof-hotspot'));
  assert.ok(por['/ip/hotspot/user/profile/set'].includes('=keepalive-timeout=30m'));
  assert.ok(por['/ip/hotspot/user/profile/set'].includes('=idle-timeout=none'));
  assert.ok(por['/ip/hotspot/user/profile/set'].includes('=numbers=default'));
  assert.ok(por['/ip/hotspot/profile/set'].includes('=login-by=http-chap,http-pap,mac-cookie'));
  assert.ok(por['/ip/hotspot/user/profile/set'].includes('=add-mac-cookie=yes'));
  assert.ok(por['/ip/hotspot/user/profile/set'].includes('=mac-cookie-timeout=1h'));
  const radiusSets = conn.chamadas.filter((c) => c.caminho === '/radius/set').map((c) => c.args);
  assert.deepStrictEqual(radiusSets[0], ['=.id=*1', '=timeout=3s']);
  assert.deepStrictEqual(radiusSets[1], ['=.id=*1', '=require-message-auth=no']);
});

test('require-message-auth: RouterOS v6 (parametro inexistente) nao conta como falha', async () => {
  const conn = conexaoFalsa();
  const orig = conn.write;
  conn.write = async (c, a = []) => {
    if (c === '/radius/set' && a.includes('=require-message-auth=no')) throw new Error('unknown parameter require-message-auth');
    return orig(c, a);
  };
  const r = await aplicarPadroesHotspot(MK, () => conn);
  assert.strictEqual(r.ok, true);
});

test('aplicarPadroesHotspot poe addresses-per-mac=1 em cada hotspot server', async () => {
  const conn = conexaoFalsa();
  const orig = conn.write;
  conn.write = async (c, a = []) => (c === '/ip/hotspot/print' ? (conn.chamadas.push({ caminho: c, args: a }), [{ '.id': '*9' }]) : orig(c, a));
  await aplicarPadroesHotspot(MK, () => conn);
  const set = conn.chamadas.find((c) => c.caminho === '/ip/hotspot/set');
  assert.deepStrictEqual(set.args, ['=.id=*9', '=addresses-per-mac=1']);
});

test('um ajuste que falha nao impede os outros e a falha e reportada', async () => {
  const conn = conexaoFalsa({ falha: { '/ip/hotspot/profile/set': 'no such item' } });
  const r = await aplicarPadroesHotspot(MK, () => conn);
  assert.strictEqual(r.ok, false);
  assert.match(r.mensagem, /hotspot profile: no such item/);
  assert.ok(conn.chamadas.some((c) => c.caminho === '/ip/hotspot/user/profile/set'));
  assert.ok(conn.chamadas.some((c) => c.caminho === '/radius/set'));
});

test('roteador offline devolve ok:false sem lancar erro; sem cliente RADIUS do hotspot e avisado', async () => {
  const off = await aplicarPadroesHotspot(MK, () => conexaoFalsa({ naoConecta: true }));
  assert.strictEqual(off.ok, false);
  assert.match(off.mensagem, /Falha ao conectar/);
  const semRadius = await aplicarPadroesHotspot(MK, () => conexaoFalsa({ radius: [] }));
  assert.strictEqual(semRadius.ok, false);
  assert.match(semRadius.mensagem, /cliente RADIUS/);
});

test('o assistente do hotspot usa as mesmas constantes (novos equipamentos nascem certos)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  for (const trecho of ['=radius-interim-update=${HOTSPOT_PADROES.radiusInterimUpdate}', '=keepalive-timeout=${HOTSPOT_PADROES.keepaliveTimeout}', '=idle-timeout=${HOTSPOT_PADROES.idleTimeout}', '=timeout=${HOTSPOT_PADROES.radiusTimeout}', '=login-by=${HOTSPOT_PADROES.loginBy}', '=mac-cookie-timeout=${HOTSPOT_PADROES.macCookieTimeout}']) {
    assert.ok(src.includes(trecho), trecho);
  }
});

test('configurarWifiAP poe o rotador em ap-bridge com o SSID e confirma', async () => {
  const estado = { name: 'wlan1', mode: 'station', ssid: 'MikroTik' };
  const escritas = [];
  const r = await configurarWifiAP({
    ifName: 'wlan1', ssid: ' Meu Wifi ',
    print: async () => [estado],
    write: async (c, a) => { escritas.push({ c, a }); estado.mode = 'ap-bridge'; estado.ssid = 'Meu Wifi'; return []; },
  });
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(escritas[0].a, ['=numbers=wlan1', '=mode=ap-bridge', '=ssid=Meu Wifi', '=security-profile=default', '=disabled=no']);
});

test('configurarWifiAP: SSID invalido, pacote sem wireless e erro viram aviso sem escrever/lancar', async () => {
  let escreveu = false;
  const write = async () => { escreveu = true; return []; };
  assert.strictEqual((await configurarWifiAP({ ifName: 'wlan1', ssid: 'x'.repeat(33), print: async () => [], write })).status, 'aviso');
  assert.strictEqual((await configurarWifiAP({ ifName: 'wlan1', ssid: 'ok', print: async () => [], write })).status, 'aviso');
  assert.strictEqual((await configurarWifiAP({ ifName: 'wlan1', ssid: 'ok', print: async () => { throw new Error('boom'); }, write })).status, 'aviso');
  assert.strictEqual(escreveu, false);
});

test('ehInterfaceWifi reconhece wlan/wifi e ignora ether', () => {
  assert.ok(ehInterfaceWifi('wlan1')); assert.ok(ehInterfaceWifi('x', 'wlan'));
  assert.ok(!ehInterfaceWifi('ether2', 'ether'));
});
