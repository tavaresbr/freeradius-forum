// Cadastro manual (tela Clientes): nao grava MAC/aceite LGPD do corpo e nao transplanta cadastro com dono para outro CPF.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const CPF_A = '52998224725';
const CPF_B = '11144477735';
const silencia = () => { const l = console.error, w = console.warn; console.error = console.warn = () => {}; return () => { console.error = l; console.warn = w; }; };

function ctrl(db) {
  delete require.cache[require.resolve(path.join(ROOT, 'src/utils/leadUtils.js'))];
  return carregar('src/controllers/leadController.js', {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({}) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({}) },
    },
  });
}

const BASE = { nome: 'Fulano', email: 'a@b.com', telefone: '(11) 98888-7777', data_nascimento: '1990-01-01' };

test('criarLead ignora mac, ip, origem e lgpd_aceite enviados no corpo', async () => {
  const db = criarDb(async (sql) => (/INSERT INTO leads/.test(sql) ? [{ insertId: 7 }] : undefined));
  const c = ctrl(db);
  const res = criarRes();
  await c.criarLead(criarReq({ empresa_id: 5, body: { ...BASE, cpf: CPF_A, mac: 'AA:BB:CC:DD:EE:FF', ip: '1.2.3.4', origem: 'importacao', lgpd_aceite: 1 } }), res);
  assert.strictEqual(res.statusCode, 201);
  const ins = db.calls.find((x) => /INSERT INTO leads/.test(x.sql));
  assert.ok(!/\bmac\b|\bip\b/.test(ins.sql.split('VALUES')[0]), 'nao grava mac/ip');
  assert.ok(!ins.params.includes('AA:BB:CC:DD:EE:FF'));
  assert.ok(!ins.params.includes('importacao'));
  assert.ok(ins.params.includes('manual'));
  assert.strictEqual(ins.params[3], 0, 'lgpd_aceite = 0');
});

function dbAtualizar({ atual, confirmado = false }) {
  return criarDb(async (sql) => {
    if (/FROM leads WHERE id = \?/.test(sql)) return [[atual]];
    if (/FROM pagamentos/.test(sql)) return [confirmado ? [{ 1: 1 }] : []];
    if (/FROM leads l WHERE/.test(sql)) return [[]];
    if (/FROM leads WHERE REPLACE/.test(sql)) return [[]];
    if (/UPDATE leads/.test(sql)) return [{ affectedRows: 1 }];
    return undefined;
  });
}
const LEAD = { nome: 'F', cpf: CPF_A, cnpj: null, tipo_pessoa: 'PF', email: 'a@b.com', telefone: '11988887777', data_nascimento: '1990-01-01', mac: null, lgpd_aceite: 0, importado_em: null };

async function trocar(atual, confirmado) {
  const db = dbAtualizar({ atual, confirmado });
  const res = criarRes();
  const restaura = silencia();
  try { await ctrl(db).atualizarLead(criarReq({ empresa_id: 5, params: { id: 3 }, body: { cpf: CPF_B } }), res); } finally { restaura(); }
  return { res, db };
}

for (const [nome, atual, confirmado] of [
  ['com MAC do portal', { ...LEAD, mac: 'aa:bb:cc:dd:ee:ff' }, false],
  ['com aceite LGPD', { ...LEAD, lgpd_aceite: 1 }, false],
  ['importado', { ...LEAD, importado_em: '2026-01-01' }, false],
  ['com CPF confirmado por pagamento', LEAD, true],
]) {
  test(`atualizarLead recusa trocar o CPF de cadastro ${nome}`, async () => {
    const { res, db } = await trocar(atual, confirmado);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(!db.calls.some((x) => /UPDATE leads/.test(x.sql)));
  });
}

test('atualizarLead permite trocar CPF de cadastro manual sem dono', async () => {
  const { res, db } = await trocar(LEAD, false);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(db.calls.some((x) => /UPDATE leads/.test(x.sql)));
});

test('atualizarLead permite editar outros campos de cadastro com dono', async () => {
  const db = dbAtualizar({ atual: { ...LEAD, mac: 'aa:bb:cc:dd:ee:ff' } });
  const res = criarRes();
  await ctrl(db).atualizarLead(criarReq({ empresa_id: 5, params: { id: 3 }, body: { nome: 'Novo Nome' } }), res);
  assert.strictEqual(res.statusCode, 200);
});
