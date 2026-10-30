const test = require('node:test');
const assert = require('node:assert');
const IntelbrasDriver = require('../../src/gateways/IntelbrasDriver');
const { detectPortalVendor } = require('../../src/utils/portalVendor');
const { calcularTrilha } = require('../../src/utils/trilhaAtivacao');

test('IntelbrasDriver: teste de conexao ok, sem desconexao ativa nem sessoes', async () => {
  const d = new IntelbrasDriver({ tipo: 'intelbras', id: 1, ip: '10.8.0.9' });
  const r = await d.testConnection();
  assert.equal(r.sucesso, true);
  const rev = await d.revoke();
  assert.equal(rev.success, false);
  assert.deepEqual(await d.getActiveSessions(), []);
});

test('portalVendor: tipo intelbras normaliza MAC/IP do redirect', () => {
  const ctx = detectPortalVendor(
    { client_mac: 'AA:BB:CC:DD:EE:FF', client_ip: '192.168.1.50', ap_mac: '11:22:33:44:55:66', login_url: 'http://192.168.1.1/login' },
    { tipo: 'intelbras' }
  );
  assert.equal(ctx.vendor, 'intelbras');
  assert.equal(ctx.mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(ctx.ip, '192.168.1.50');
  assert.equal(ctx.raw.login_url, 'http://192.168.1.1/login');
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
