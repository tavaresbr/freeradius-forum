// Diagnostico do hotspot em 1 clique: so leitura, distingue "nao existe" de "nao consegui ler".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { diagnosticarHotspot } = require('../../src/utils/diagnosticoHotspot');

const roteadorOk = () => ({
  '/ip/hotspot/print': [{ name: 'hotspot1', interface: 'bridge-hotspot', 'address-pool': 'hs-pool', profile: 'hsprof-hotspot', disabled: 'false' }],
  '/ip/hotspot/profile/print': [{ name: 'hsprof-hotspot', 'use-radius': 'true', 'dns-name': '', 'html-directory': 'hotspot' }],
  '/ip/address/print': [{ address: '10.5.50.1/24', interface: 'bridge-hotspot', network: '10.5.50.0' }],
  '/interface/bridge/port/print': [{ bridge: 'bridge-hotspot', interface: 'ether2' }, { bridge: 'bridge-hotspot', interface: 'wlan1' }],
  '/interface/wireless/print': [{ name: 'wlan1', ssid: 'rb09', disabled: 'false', running: 'true' }],
  '/ip/dhcp-server/network/print': [{ address: '10.5.50.0/24', gateway: '10.5.50.1', 'dns-server': '10.5.50.1' }],
  '/ip/dhcp-server/print': [{ name: 'dhcp-hotspot', interface: 'bridge-hotspot', disabled: 'false' }],
  '/ip/dns/print': [{ 'allow-remote-requests': 'true', servers: '8.8.8.8' }],
  '/ip/firewall/nat/print': [
    { chain: 'hotspot', action: 'redirect', 'dst-port': '53', packets: '3' },
    { chain: 'hs-unauth', action: 'redirect', 'dst-port': '80', packets: '9' },
  ],
  '/ip/hotspot/walled-garden/print': [{ 'dst-host': '*painel.apextelecom.com.br*', action: 'allow' }],
  '/radius/print': [{ address: '10.8.0.1', service: 'hotspot' }],
  '/ip/pool/print': [{ name: 'hs-pool', ranges: '10.5.50.2-10.5.50.254' }],
  '/file/print': [{ name: 'hotspot/redirect.html', size: '600' }, { name: 'hotspot/login.html', size: '1761' }, { name: 'hotspot/error.html', size: '1379' }, { name: 'hotspot/status.html', size: '900' }],
  '/ip/hotspot/host/print': [{}, {}],
  '/ip/hotspot/active/print': [],
});

// ler() falso: devolve a tabela; "tira" os caminhos pedidos (ok:false = leitura que expirou)
function lerDe(tabela, { expira = [], contents = '<a href="https://painel.apextelecom.com.br/hotspot/redirect/16?mac=$(mac)">' } = {}) {
  return async (p, args = []) => {
    if (expira.includes(p)) return { ok: false, itens: [] };
    if (p === '/file/print' && args.some((a) => String(a).startsWith('?name='))) return { ok: true, itens: [{ contents }] };
    return { ok: true, itens: tabela[p] || [] };
  };
}
const base = { mikrotik: { id: 16, end_hotspot: '10.5.50.1' }, portalHost: 'painel.apextelecom.com.br' };
const por = (r, id) => r.checks.filter((c) => c.id === id);

test('roteador correto: nenhum erro', async () => {
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(roteadorOk()) });
  assert.strictEqual(r.resumo.erro, 0, JSON.stringify(r.checks.filter((c) => c.status === 'erro')));
  assert.strictEqual(r.gateway, '10.5.50.1');
});

test('caso RB09: DNS externo no DHCP e dns-name inexistente viram erro com correcao automatica', async () => {
  const t = roteadorOk();
  t['/ip/dhcp-server/network/print'][0]['dns-server'] = '8.8.8.8';
  t['/ip/hotspot/profile/print'][0]['dns-name'] = 'hotspot.minharede.com';
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(t), resolve: async () => false });
  const dns = por(r, 'dns_dhcp')[0];
  assert.strictEqual(dns.status, 'erro');
  assert.strictEqual(dns.correcao.acao, 'dns_dhcp');
  const nome = por(r, 'dns_name')[0];
  assert.strictEqual(nome.status, 'erro');
  assert.strictEqual(nome.correcao.acao, 'dns_name');
  // end_hotspot do banco diverge do dns-name do roteador
  assert.strictEqual(por(r, 'end_hotspot')[0].status, 'erro');
});

test('leitura que expirou NAO vira "nao existe": e aviso indeterminado', async () => {
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(roteadorOk(), { expira: ['/radius/print', '/ip/pool/print'] }) });
  assert.strictEqual(por(r, 'radius')[0].status, 'aviso');
  assert.match(por(r, 'radius')[0].detalhe, /Nao consegui ler/);
  assert.strictEqual(por(r, 'pool')[0].status, 'aviso');
  assert.strictEqual(r.resumo.erro, 0);
});

test('roteador sem hotspot (reset): erro claro e nao confunde o resto', async () => {
  const r = await diagnosticarHotspot({ ...base, ler: lerDe({ '/file/print': [{ name: 'hotspot/error.html', size: '10' }] }) });
  assert.strictEqual(por(r, 'hotspot')[0].status, 'erro');
  assert.match(por(r, 'hotspot')[0].detalhe, /Nao existe hotspot/);
});

test('login.html que nao aponta para este equipamento e erro; ausente tambem', async () => {
  let r = await diagnosticarHotspot({ ...base, ler: lerDe(roteadorOk(), { contents: '<html>outro</html>' }) });
  assert.strictEqual(por(r, 'arquivos')[0].status, 'erro');
  const t = roteadorOk();
  t['/file/print'] = [];
  r = await diagnosticarHotspot({ ...base, ler: lerDe(t) });
  assert.strictEqual(por(r, 'arquivos')[0].status, 'erro');
});

test('walled garden sem o dominio do portal e bridge sem portas sao erros; DNS remoto desligado tem correcao', async () => {
  const t = roteadorOk();
  t['/ip/hotspot/walled-garden/print'] = [{ 'dst-host': '*outro.com*', action: 'allow' }];
  t['/interface/bridge/port/print'] = [];
  t['/ip/dns/print'] = [{ 'allow-remote-requests': 'false' }];
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(t) });
  assert.strictEqual(por(r, 'walled')[0].status, 'erro');
  assert.strictEqual(por(r, 'bridge')[0].status, 'erro');
  assert.strictEqual(por(r, 'dns_remoto')[0].correcao.acao, 'dns_remoto');
});

test('rotas: diagnostico e so leitura, correcao valida a acao, assistente tem trava e so grava end_hotspot com sucesso', () => {
  const rota = fs.readFileSync(path.join(__dirname, '../../src/routes/mikrotikRoutes.js'), 'utf8');
  assert.ok(rota.includes('"/:id/diagnostico-hotspot"'));
  assert.ok(rota.includes('["dns_dhcp", "dns_remoto", "dns_name", "end_hotspot", "reset_html", "enviar_status"].includes(acao)'));
  assert.ok(rota.includes('hotspotEmExecucao.has(chaveExecucao)'));
  assert.ok(rota.includes('if (result.success) {'));
  const util = fs.readFileSync(path.join(__dirname, '../../src/utils/diagnosticoHotspot.js'), 'utf8');
  assert.ok(!/conn\.write\([^)]*\/(set|add|remove)/.test(util), 'o diagnostico nao pode escrever no roteador');
});

test('caso RB09: sem redirect.html vira erro com correcao reset_html', async () => {
  const t = roteadorOk();
  t['/file/print'] = t['/file/print'].filter((f) => f.name !== 'hotspot/redirect.html');
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(t) });
  const c = por(r, 'redirect_html')[0];
  assert.strictEqual(c.status, 'erro');
  assert.strictEqual(c.correcao.acao, 'reset_html');
});

test('status.html: ausente vira aviso com correcao enviar_status; presente fica ok', async () => {
  const t = roteadorOk();
  t['/file/print'] = t['/file/print'].filter((f) => f.name !== 'hotspot/status.html');
  const r = await diagnosticarHotspot({ ...base, ler: lerDe(t) });
  const c = por(r, 'status_html')[0];
  assert.strictEqual(c.status, 'aviso');
  assert.strictEqual(c.correcao.acao, 'enviar_status');
  const ok = await diagnosticarHotspot({ ...base, ler: lerDe(roteadorOk()) });
  assert.strictEqual(por(ok, 'status_html')[0].status, 'ok');
});

test('assistente envia status.html (passo 9c) e a correcao enviar_status existe na rota', () => {
  const setup = fs.readFileSync(path.join(__dirname, '../../src/utils/hotspotSetup.js'), 'utf8');
  assert.ok(setup.includes('addStep("status_page"'));
  assert.ok(setup.includes('/api/hotspot-status/${mikrotik.id}'));
  const rota = fs.readFileSync(path.join(__dirname, '../../src/routes/mikrotikRoutes.js'), 'utf8');
  assert.ok(rota.includes('if (acao === "enviar_status")'));
});
