// Trocar so o nome (SSID) do Wi-Fi de um equipamento ja configurado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renomearWifi, lerWifi, validarSsid } = require('../../src/utils/hotspotSetup');

// roteador falso: wlan1 e wlan2 no pacote wireless legado
function roteador({ expira = [], antes = [{ name: 'wlan1', ssid: 'RB09-teste', disabled: 'false' }, { name: 'wlan2', ssid: 'RB09-5g', disabled: 'false' }], gravaMesmo = true } = {}) {
  const estado = antes.map((r) => ({ ...r }));
  const escritas = [];
  return {
    escritas,
    estado,
    ler: async (p) => {
      if (expira.includes(p)) return { ok: false, itens: [] };
      if (p === '/interface/wireless/print') return { ok: true, itens: estado.map((r) => ({ ...r })) };
      return { ok: true, itens: [] };
    },
    escrever: async (p, args) => {
      escritas.push([p, args]);
      const nome = args.find((a) => a.startsWith('=numbers=')).slice(9);
      const ssid = args.find((a) => a.startsWith('=ssid=')).slice(6);
      if (gravaMesmo) estado.find((r) => r.name === nome).ssid = ssid;
    },
  };
}

test('validarSsid: vazio, aspas, controle e mais de 32 bytes sao recusados; espacos nas pontas saem', () => {
  assert.strictEqual(validarSsid('').ok, false);
  assert.strictEqual(validarSsid('   ').ok, false);
  assert.strictEqual(validarSsid('Rede "x').ok, false);
  assert.strictEqual(validarSsid('a\\b').ok, false);
  assert.strictEqual(validarSsid('a\nb').ok, false);
  assert.strictEqual(validarSsid('a'.repeat(33)).ok, false);
  assert.strictEqual(validarSsid('a'.repeat(32)).ok, true);
  assert.strictEqual(validarSsid('é'.repeat(17)).ok, false, 'acentos contam por byte (34 bytes)');
  assert.strictEqual(validarSsid(' Meu Wifi ').nome, 'Meu Wifi');
});

test('renomearWifi: grava SO o ssid (nunca modo, seguranca nem disabled) e confere no roteador', async () => {
  const r = roteador();
  const out = await renomearWifi({ radios: ['wlan1', 'wlan2'], ssid: 'Tavares Fibra', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(r.escritas.length, 2);
  for (const [p, args] of r.escritas) {
    assert.strictEqual(p, '/interface/wireless/set');
    assert.deepStrictEqual(args.filter((a) => !a.startsWith('=numbers=')), ['=ssid=Tavares Fibra']);
  }
  assert.deepStrictEqual(out.radios.map((x) => x.status), ['ok', 'ok']);
});

test('renomearWifi: radio inexistente recusa tudo sem escrever', async () => {
  const r = roteador();
  const out = await renomearWifi({ radios: ['wlan1', 'wlan9'], ssid: 'Novo', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'erro');
  assert.strictEqual(r.escritas.length, 0);
});

test('renomearWifi: SSID invalido ou lista vazia nao toca o roteador', async () => {
  const r = roteador();
  assert.strictEqual((await renomearWifi({ radios: ['wlan1'], ssid: '', ler: r.ler, escrever: r.escrever })).status, 'erro');
  assert.strictEqual((await renomearWifi({ radios: [], ssid: 'Ok', ler: r.ler, escrever: r.escrever })).status, 'erro');
  assert.strictEqual(r.escritas.length, 0);
});

test('renomearWifi: leitura que expira vira aviso e NAO escreve (nunca assume "nao existe")', async () => {
  const r = roteador({ expira: ['/interface/wireless/print'] });
  const out = await renomearWifi({ radios: ['wlan1'], ssid: 'Novo', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'aviso');
  assert.strictEqual(r.escritas.length, 0);
});

test('renomearWifi: gravou mas o roteador nao confirma o nome = aviso com o comando manual', async () => {
  const r = roteador({ gravaMesmo: false });
  const out = await renomearWifi({ radios: ['wlan1'], ssid: 'Novo', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'aviso');
  assert.match(out.radios[0].message, /interface wireless set wlan1 ssid="Novo"/);
});

test('renomearWifi: erro ao gravar um radio nao impede o outro e vira erro no resultado', async () => {
  const r = roteador();
  const base = r.escrever;
  r.escrever = async (p, args) => { if (args.includes('=numbers=wlan1')) throw new Error('timeout'); return base(p, args); };
  const out = await renomearWifi({ radios: ['wlan1', 'wlan2'], ssid: 'Novo', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'erro');
  assert.deepStrictEqual(out.radios.map((x) => x.status), ['erro', 'ok']);
});

test('lerWifi: pacote wifi novo do v7 (sem wireless) vira aviso com o comando manual; sem radios avisa', async () => {
  const novo = await lerWifi({ ler: async (p) => (p === '/interface/wifi/print' ? { ok: true, itens: [{ name: 'wifi1' }] } : { ok: true, itens: [] }) });
  assert.strictEqual(novo.legado, false);
  assert.match(novo.message, /interface wifi configuration/);
  const nenhum = await lerWifi({ ler: async () => ({ ok: true, itens: [] }) });
  assert.strictEqual(nenhum.radios.length, 0);
  const expirou = await lerWifi({ ler: async () => ({ ok: false, itens: [] }) });
  assert.strictEqual(expirou.ok, false);
});

test('rota e tela: PUT /:id/wifi valida, e o botao Wi-Fi existe so para MikroTik', () => {
  const rota = fs.readFileSync(path.join(__dirname, '../../src/routes/mikrotikRoutes.js'), 'utf8');
  assert.ok(rota.includes('router.put("/:id/wifi", somenteMikrotik'));
  assert.ok(rota.includes('router.post("/:id/wifi", somenteMikrotik'));
  assert.ok(rota.includes('validarSsid(body.ssid)'));
  assert.ok(rota.includes('WHERE id = ? AND empresa_id = ?'));
  const front = fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/admin/Mikrotiks.jsx'), 'utf8');
  const i = front.indexOf('abrirWifi(m)');
  assert.ok(i > 0 && front.lastIndexOf('{isMikrotik && (', i) > front.indexOf('const renderAcoes'));
  const audit = require('../../src/utils/auditoria');
  assert.strictEqual(audit.classificar('PUT', '/api/mikrotiks/18/wifi').acao, 'equipamento.wifi');
});
