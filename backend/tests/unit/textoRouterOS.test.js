// A lib node-routeros fala win1252; o RouterOS guarda UTF-8. Ida e volta tem que ser exata.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const iconv = require('iconv-lite');
const { lerDoRoteador, paraORoteador } = require('../../src/utils/textoRouterOS');
const { renomearWifi, lerWifi, configurarWifiAP, validarSsid } = require('../../src/utils/hotspotSetup');

const AMOSTRAS = ['#Seld-WiFi-Grátis', 'Açaí & Café ñ', 'Olá €100', 'Rede 日本', 'Só ASCII', 'ç', ''];

// "Roteador" que guarda BYTES UTF-8 e conversa com a aplicacao pela mesma ponte da lib (win1252).
function roteadorWin1252(ssidInicial) {
  let bytes = Buffer.from(ssidInicial, 'utf8');
  const doRoteadorParaLib = () => iconv.decode(bytes, 'win1252');             // o que a lib entrega ao codigo
  const daLibParaRoteador = (str) => Buffer.from(iconv.encode(str, 'win1252')); // o que a lib grava
  return {
    bytesHex: () => bytes.toString('hex'),
    ler: async (p) => (p === '/interface/wireless/print'
      ? { ok: true, itens: [{ name: 'wlan1', ssid: doRoteadorParaLib(), disabled: 'false', mode: 'ap-bridge' }] }
      : { ok: true, itens: [] }),
    print: async (p) => (p === '/interface/wireless/print'
      ? [{ name: 'wlan1', ssid: doRoteadorParaLib(), disabled: 'false', mode: 'ap-bridge' }] : []),
    escrever: async (p, args) => {
      const a = args.find((x) => x.startsWith('=ssid='));
      if (a) bytes = daLibParaRoteador(a.slice(6));
    },
  };
}

test('lerDoRoteador/paraORoteador: ida e volta exata (acentos, cedilha, euro, CJK)', () => {
  for (const t of AMOSTRAS) {
    assert.strictEqual(lerDoRoteador(paraORoteador(t)), t, t);
  }
  assert.strictEqual(lerDoRoteador('#Seld-WiFi-GrÃ¡tis'), '#Seld-WiFi-Grátis', 'caso real do RB06');
  assert.strictEqual(lerDoRoteador(undefined), undefined);
  assert.strictEqual(paraORoteador(null), null);
});

test('texto sem acento nao muda (nao quebra o que ja funcionava)', () => {
  assert.strictEqual(paraORoteador('RB09-Tavares09'), 'RB09-Tavares09');
  assert.strictEqual(lerDoRoteador('#RB09-teste'), '#RB09-teste');
});

test('lerWifi mostra o SSID certo de um roteador que ja tem acento (RB06)', async () => {
  const r = roteadorWin1252('#Seld-WiFi-Grátis');
  const w = await lerWifi({ ler: r.ler });
  assert.strictEqual(w.radios[0].ssid, '#Seld-WiFi-Grátis');
});

test('renomearWifi: "Grátis" fica em UTF-8 no roteador (c3a1) e a conferencia fecha', async () => {
  const r = roteadorWin1252('#Seld-WiFi-Gratis');
  const out = await renomearWifi({ radios: ['wlan1'], ssid: 'Teste Grátis', ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'ok', JSON.stringify(out));
  assert.strictEqual(Buffer.from(r.bytesHex(), 'hex').toString('utf8'), 'Teste Grátis');
  assert.ok(r.bytesHex().includes('c3a1'), 'a com acento gravado em UTF-8, nao como o byte e1');
  assert.ok(!r.bytesHex().includes('e1'.repeat(1) + '7469'), 'nao pode haver o byte solto e1 antes de "ti"');
});

test('renomearWifi: reenviar o mesmo nome com acento nao corrompe o SSID', async () => {
  const r = roteadorWin1252('#Seld-WiFi-Grátis');
  const antes = r.bytesHex();
  const lido = (await lerWifi({ ler: r.ler })).radios[0].ssid; // o que a tela mostra ja corrigido
  const out = await renomearWifi({ radios: ['wlan1'], ssid: lido, ler: r.ler, escrever: r.escrever });
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(r.bytesHex(), antes);
});

test('configurarWifiAP (1o envio do assistente) tambem grava UTF-8 e confere com o nome certo', async () => {
  const r = roteadorWin1252('x');
  const out = await configurarWifiAP({ ifName: 'wlan1', ssid: 'Café Grátis', print: r.print, write: r.escrever });
  assert.strictEqual(out.status, 'ok', JSON.stringify(out));
  assert.strictEqual(Buffer.from(r.bytesHex(), 'hex').toString('utf8'), 'Café Grátis');
});

test('validarSsid: caracteres de controle C1 (que nao fazem ida e volta) sao recusados; acento comum passa', () => {
  assert.strictEqual(validarSsid('a\u0081b').ok, false);
  assert.strictEqual(validarSsid('a\u009fb').ok, false);
  assert.strictEqual(validarSsid('Grátis').ok, true);
});

test('iconv-lite esta declarado no package.json do backend (nao depende de hoisting)', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.ok(pj.dependencies['iconv-lite']);
});
