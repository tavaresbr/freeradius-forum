// Padroes do hotspot (keepalive, interim-update, timeout RADIUS) aplicados a todo MikroTik.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOTSPOT_PADROES, ON_LOGOUT_HOTSPOT, scriptOnLogout, BLOCK_REDIRECT } = require('../../src/constants/hotspotDefaults');
const { aplicarPadroesHotspot, configurarWifiAP, ehInterfaceWifi, configurarDnsSeguro, prepararBridgeHotspot, sanitizarBridge, configurarOnLogout, configurarBlockRedirect } = require('../../src/utils/hotspotSetup');

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

function roteadorDns({ servers = '8.8.8.8,1.1.1.1', rede = true, semDns = false } = {}) {
  const escritas = [];
  return {
    escritas,
    print: async (c) => {
      if (c === '/ip/dns/print') return semDns ? [] : [{ servers }];
      if (c === '/ip/dhcp-server/network/print') return rede ? [{ '.id': '*5', address: '10.5.50.0/24' }] : [];
      return [];
    },
    write: async (c, a) => { escritas.push({ c, a }); return []; },
  };
}
const ARGS_DNS = { gateway: '10.5.50.1', network: '10.5.50.0/24' };

test('DNS seguro ligado: servidores filtrados no roteador e gateway como DNS do DHCP', async () => {
  const r = roteadorDns();
  const res = await configurarDnsSeguro({ ligar: true, ...ARGS_DNS, ...r });
  assert.strictEqual(res.status, 'ok');
  assert.deepStrictEqual(r.escritas[0], { c: '/ip/dns/set', a: ['=servers=208.67.222.123,208.67.220.123', '=allow-remote-requests=yes'] });
  assert.deepStrictEqual(r.escritas[1], { c: '/ip/dhcp-server/network/set', a: ['=.id=*5', '=dns-server=10.5.50.1'] });
});

test('DNS seguro desligado: so reverte se o roteador usa o DNS filtrado', async () => {
  const filtrado = roteadorDns({ servers: '208.67.222.123,208.67.220.123' });
  const a = await configurarDnsSeguro({ ligar: false, ...ARGS_DNS, ...filtrado });
  assert.strictEqual(a.status, 'ok');
  assert.deepStrictEqual(filtrado.escritas[0].a, ['=servers=8.8.8.8,1.1.1.1', '=allow-remote-requests=yes']);
  assert.deepStrictEqual(filtrado.escritas[1].a, ['=.id=*5', '=dns-server=8.8.8.8']);

  const manual = roteadorDns({ servers: '9.9.9.9' });
  const b = await configurarDnsSeguro({ ligar: false, ...ARGS_DNS, ...manual });
  assert.strictEqual(b.status, 'ok');
  assert.strictEqual(manual.escritas.length, 0);
});

test('DNS seguro: sem leitura do DNS ou erro de escrita vira aviso sem lancar', async () => {
  const sem = roteadorDns({ semDns: true });
  assert.strictEqual((await configurarDnsSeguro({ ligar: false, ...ARGS_DNS, ...sem })).status, 'aviso');
  assert.strictEqual(sem.escritas.length, 0);
  const falha = { ...roteadorDns(), write: async () => { throw new Error('boom'); } };
  assert.strictEqual((await configurarDnsSeguro({ ligar: true, ...ARGS_DNS, ...falha })).status, 'aviso');
});

test('assistente so mexe no DNS quando dnsSeguro e true/false', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  assert.ok(src.includes('config.dnsSeguro === true || config.dnsSeguro === false'));
});

// --- bridge do hotspot ---
function roteadorBridge({ interfaces, bridges = [], portas = [], enderecos = [], dhcps = [], wan = [], falhaEscrita = null, naoConfirma = false } = {}) {
  const itfs = interfaces || [
    { name: 'ether1', type: 'ether' }, { name: 'ether2', type: 'ether' },
    { name: 'wlan1', type: 'wlan' }, { name: 'wlan2', type: 'wlan' },
  ];
  const estado = { bridges: [...bridges], portas: [...portas] };
  const escritas = [];
  return {
    escritas,
    estado,
    print: async (c) => {
      if (c === '/interface/print') return itfs;
      if (c === '/interface/bridge/print') return estado.bridges;
      if (c === '/interface/bridge/port/print') return estado.portas;
      if (c === '/ip/address/print') return enderecos;
      if (c === '/ip/dhcp-server/print') return dhcps;
      if (c === '/ip/dhcp-client/print') return wan.map((interface_) => ({ interface: interface_ }));
      return [];
    },
    write: async (c, a) => {
      escritas.push({ c, a });
      if (falhaEscrita) throw new Error(falhaEscrita);
      if (c === '/interface/bridge/add') estado.bridges.push({ name: a[0].replace('=name=', '') });
      if (c === '/interface/bridge/port/add' && !naoConfirma) {
        estado.portas.push({ bridge: a[0].replace('=bridge=', ''), interface: a[1].replace('=interface=', '') });
      }
      return 'ok';
    },
  };
}

test('bridge: cria a bridge, adiciona as portas e isola os radios Wi-Fi', async () => {
  const r = roteadorBridge();
  const res = await prepararBridgeHotspot({ portas: ['wlan1', 'wlan2', 'ether2'], print: r.print, write: r.write });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.wifiPortas, ['wlan1', 'wlan2']);
  const caminhos = r.escritas.map((e) => e.c);
  assert.strictEqual(caminhos.filter((c) => c === '/interface/bridge/add').length, 1);
  assert.strictEqual(caminhos.filter((c) => c === '/interface/bridge/port/add').length, 3);
  assert.deepStrictEqual(r.escritas.find((e) => e.c === '/interface/wireless/set' && e.a.includes('=numbers=wlan2')).a, ['=numbers=wlan2', '=default-forwarding=no']);
});

test('bridge: idempotente (segunda execucao nao duplica bridge nem portas)', async () => {
  const r = roteadorBridge({ bridges: [{ name: 'bridge-hotspot' }], portas: [{ bridge: 'bridge-hotspot', interface: 'wlan1' }] });
  const res = await prepararBridgeHotspot({ portas: ['wlan1', 'ether2'], print: r.print, write: r.write });
  assert.strictEqual(res.ok, true);
  const adds = r.escritas.filter((e) => e.c === '/interface/bridge/port/add');
  assert.strictEqual(adds.length, 1);
  assert.ok(adds[0].a.includes('=interface=ether2'));
  assert.ok(!r.escritas.some((e) => e.c === '/interface/bridge/add'));
});

test('bridge: recusa WAN, porta de outra bridge, porta com IP/DHCP, inexistente, tipo invalido e lista vazia sem escrever nada', async () => {
  const casos = [
    [{ wan: ['ether1'] }, ['ether1'], /WAN/],
    [{ portas: [{ bridge: 'bridge', interface: 'ether2' }] }, ['ether2'], /ja e porta da bridge bridge/],
    [{ enderecos: [{ interface: 'ether2', address: '192.168.88.1/24' }] }, ['ether2'], /tem IP/],
    [{ dhcps: [{ interface: 'ether2' }] }, ['ether2'], /DHCP server proprio/],
    [{}, ['ether9'], /nao existe/],
    [{ interfaces: [{ name: 'vlan10', type: 'vlan' }] }, ['vlan10'], /nao pode entrar/],
    [{}, [], /ao menos uma/],
  ];
  for (const [cfg, portas, esperado] of casos) {
    const r = roteadorBridge(cfg);
    const res = await prepararBridgeHotspot({ portas, print: r.print, write: r.write });
    assert.strictEqual(res.ok, false, String(esperado));
    assert.match(res.message, esperado);
    assert.strictEqual(r.escritas.length, 0, 'nao deve escrever nada quando recusa');
  }
});

test('bridge: erro de escrita ou porta que nao confirma viram ok:false sem lancar', async () => {
  const erro = roteadorBridge({ falhaEscrita: 'boom' });
  const a = await prepararBridgeHotspot({ portas: ['ether2'], print: erro.print, write: erro.write });
  assert.strictEqual(a.ok, false);
  assert.match(a.message, /boom/);
  const semConfirmar = roteadorBridge({ naoConfirma: true });
  const b = await prepararBridgeHotspot({ portas: ['ether2'], print: semConfirmar.print, write: semConfirmar.write });
  assert.strictEqual(b.ok, false);
  assert.match(b.message, /Sem confirmacao/);
});

test('sanitizarBridge: so aceita true, nomes validos, sem repetir e ate o maximo', () => {
  assert.deepStrictEqual(sanitizarBridge({ criarBridge: 'true', portasBridge: ['wlan1'] }), { criarBridge: false, portasBridge: [] });
  assert.deepStrictEqual(sanitizarBridge({}), { criarBridge: false, portasBridge: [] });
  const r = sanitizarBridge({ criarBridge: true, portasBridge: ['wlan1', 'wlan1', 'ether2; /system reset', 7, null, 'ether 3', 'wlan2'] });
  assert.deepStrictEqual(r, { criarBridge: true, portasBridge: ['wlan1', 'wlan2'] });
  const muitas = Array.from({ length: 30 }, (_, i) => `ether${i}`);
  assert.strictEqual(sanitizarBridge({ criarBridge: true, portasBridge: muitas }).portasBridge.length, 12);
});

test('assistente: bridge preparada ANTES do passo 0 e falha para o envio', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  const iBridge = src.indexOf('prepararBridgeHotspot({ portas: portasBridge');
  const iPasso0 = src.indexOf('// === 0. Interface nao pode ser porta de bridge');
  assert.ok(iBridge > 0 && iBridge < iPasso0);
  assert.match(src.slice(iBridge, iPasso0), /if \(!b\.ok\)[\s\S]*addStep\("bridge", "erro"[\s\S]*return \{ success: false/);
});

// ---- on-logout opcional ----
function roteadorLogout(perfis) {
  const escritas = [];
  return {
    escritas,
    print: async () => perfis,
    write: async (caminho, args) => { escritas.push({ caminho, args }); return []; },
  };
}

test('scriptOnLogout: marcador, espera, checagem de sessao ativa e so lease dinamico', () => {
  const s = scriptOnLogout();
  assert.ok(s.startsWith(ON_LOGOUT_HOTSPOT.marcador));
  assert.match(s, /:delay 5s/);
  assert.match(s, /hotspot active find where mac-address=\$mac\]\] = 0/);
  assert.match(s, /dynamic=yes/);
  assert.match(s, /wireless registration-table/);
  assert.match(s, /wifi registration-table/);
});

test('configurarOnLogout: ligar com perfil vazio grava o script', async () => {
  const r = roteadorLogout([{ name: 'default', 'on-logout': '' }]);
  const out = await configurarOnLogout({ ligar: true, print: r.print, write: r.write });
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(r.escritas.length, 1);
  assert.ok(r.escritas[0].args.some((a) => a.startsWith('=on-logout=') && a.includes(ON_LOGOUT_HOTSPOT.marcador)));
});

test('configurarOnLogout: script alheio nao e sobrescrito nem apagado', async () => {
  for (const ligar of [true, false]) {
    const r = roteadorLogout([{ name: 'default', 'on-logout': '/log info outro' }]);
    const out = await configurarOnLogout({ ligar, print: r.print, write: r.write });
    assert.strictEqual(out.status, 'aviso');
    assert.strictEqual(r.escritas.length, 0);
  }
});

test('configurarOnLogout: ligar com o nosso regrava; desligar limpa so o nosso', async () => {
  const nosso = [{ name: 'default', 'on-logout': scriptOnLogout() }];
  let r = roteadorLogout(nosso);
  await configurarOnLogout({ ligar: true, print: r.print, write: r.write });
  assert.strictEqual(r.escritas.length, 1);
  r = roteadorLogout(nosso);
  const out = await configurarOnLogout({ ligar: false, print: r.print, write: r.write });
  assert.strictEqual(out.status, 'ok');
  assert.deepStrictEqual(r.escritas[0].args, ['=numbers=default', '=on-logout=']);
  r = roteadorLogout([{ name: 'default', 'on-logout': '' }]);
  await configurarOnLogout({ ligar: false, print: r.print, write: r.write });
  assert.strictEqual(r.escritas.length, 0);
});

test('configurarOnLogout: leitura vazia ou com erro avisa sem escrever', async () => {
  let r = roteadorLogout([]);
  let out = await configurarOnLogout({ ligar: true, print: r.print, write: r.write });
  assert.strictEqual(out.status, 'aviso');
  assert.strictEqual(r.escritas.length, 0);
  r = roteadorLogout([]);
  out = await configurarOnLogout({ ligar: true, print: async () => { throw new Error('x'); }, write: r.write });
  assert.strictEqual(out.status, 'aviso');
  assert.strictEqual(r.escritas.length, 0);
});

test('assistente so aplica on-logout com true/false e nao entra em aplicarPadroesHotspot', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  assert.match(src, /config\.onLogout === true \|\| config\.onLogout === false/);
  const ap = src.slice(src.indexOf('async function aplicarPadroesHotspot'));
  assert.ok(!/onLogout|on-logout/.test(ap.slice(0, ap.indexOf('module.exports'))));
});

// ---- BlockRedirect opcional ----
function roteadorWg(regras) {
  const escritas = [];
  return { escritas, print: async () => regras, write: async (caminho, args) => { escritas.push({ caminho, args }); return []; } };
}

test('configurarBlockRedirect: ligar cria deny com comentario para cada host', async () => {
  const r = roteadorWg([{ '.id': '*1', 'dst-host': '*meudominio*', action: 'allow' }]);
  const out = await configurarBlockRedirect({ ligar: true, print: r.print, write: r.write });
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(r.escritas.length, BLOCK_REDIRECT.hosts.length);
  for (const e of r.escritas) {
    assert.strictEqual(e.caminho, '/ip/hotspot/walled-garden/add');
    assert.ok(e.args.includes('=action=deny'));
    assert.ok(e.args.includes(`=comment=${BLOCK_REDIRECT.comentario}`));
  }
});

test('configurarBlockRedirect: ligar e idempotente (so cria o que falta)', async () => {
  const existentes = BLOCK_REDIRECT.hosts.slice(0, 4).map((h, i) => ({ '.id': `*${i}`, 'dst-host': h, action: 'deny', comment: BLOCK_REDIRECT.comentario }));
  const r = roteadorWg(existentes);
  await configurarBlockRedirect({ ligar: true, print: r.print, write: r.write });
  assert.strictEqual(r.escritas.length, BLOCK_REDIRECT.hosts.length - 4);
  const tudo = roteadorWg(BLOCK_REDIRECT.hosts.map((h, i) => ({ '.id': `*${i}`, 'dst-host': h, comment: BLOCK_REDIRECT.comentario })));
  await configurarBlockRedirect({ ligar: true, print: tudo.print, write: tudo.write });
  assert.strictEqual(tudo.escritas.length, 0);
});

test('configurarBlockRedirect: desligar remove so as regras com o nosso comentario', async () => {
  const r = roteadorWg([
    { '.id': '*1', 'dst-host': 'captive.apple.com', action: 'deny', comment: BLOCK_REDIRECT.comentario },
    { '.id': '*2', 'dst-host': 'captive.apple.com', action: 'deny', comment: 'do dono' },
    { '.id': '*3', 'dst-host': '*x*', action: 'allow' },
  ]);
  const out = await configurarBlockRedirect({ ligar: false, print: r.print, write: r.write });
  assert.strictEqual(out.status, 'ok');
  assert.deepStrictEqual(r.escritas, [{ caminho: '/ip/hotspot/walled-garden/remove', args: ['=.id=*1'] }]);
});

test('configurarBlockRedirect: erro de leitura ou escrita avisa sem lancar', async () => {
  let out = await configurarBlockRedirect({ ligar: true, print: async () => { throw new Error('x'); }, write: async () => {} });
  assert.strictEqual(out.status, 'aviso');
  out = await configurarBlockRedirect({ ligar: true, print: async () => [], write: async () => { throw new Error('falhou'); } });
  assert.strictEqual(out.status, 'aviso');
});

test('assistente so aplica BlockRedirect com true/false e nao entra em aplicarPadroesHotspot', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  assert.match(src, /config\.blockRedirect === true \|\| config\.blockRedirect === false/);
  const ap = src.slice(src.indexOf('async function aplicarPadroesHotspot'));
  assert.ok(!/blockRedirect|BLOCK_REDIRECT/.test(ap.slice(0, ap.indexOf('module.exports'))));
});
