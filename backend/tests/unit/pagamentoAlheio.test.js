// Pagar pelo CPF de outra pessoa: recusado ANTES de cobrar quando o CPF ja tem acesso ativo
// em outro aparelho. Rotas de pagamento sao publicas e aceitam cpf/cliente_id do corpo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const CPF = '529.982.247-25';
const CPF_LIMPO = '52998224725';
const MAC_DONO = 'aa:bb:cc:dd:ee:ff';
const MAC_OUTRO = '11:22:33:44:55:66';
const PLANO = { id: 9, empresa_id: 5, nome: 'Plano 1h', valor: 500, duracao_minutos: 60, mikrotik_id: 3 };

const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

function montar({ saldo, leadsDoCpf = [{ mac: MAC_DONO }], leadPorId = { id: 77, nome: 'Titular', email: 't@x.com', cpf: CPF_LIMPO, telefone: '55999991111' } } = {}) {
  const db = criarDb(async (sql) => {
    if (/FROM planos WHERE id/.test(sql)) return [[PLANO]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: { access_token: 'APP_USR-x', public_key: 'APP_USR-p' } }]];
    if (/FROM leads WHERE id = \? AND empresa_id/.test(sql)) return [leadPorId ? [leadPorId] : []];
    if (/SELECT mac FROM leads WHERE REPLACE/.test(sql)) return [leadsDoCpf];
    if (/SELECT attribute, value FROM radcheck/.test(sql)) {
      return [saldo ? [{ attribute: 'Cleartext-Password', value: 'senhaDoTitular' }, { attribute: 'Max-All-Session', value: '3600' }] : []];
    }
    if (/COALESCE\(SUM/.test(sql)) return [[{ usado: 600 }]];
    if (/INSERT INTO pagamentos/.test(sql)) throw new Error('parou aqui (sem rede)');
    return undefined;
  });
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k];
  const mod = carregar('src/controllers/pagamentoController.js', { db });
  return { db, mod };
}
const inseriu = (db) => db.calls.some((c) => /INSERT INTO pagamentos/.test(c.sql));

const reqPix = (extra = {}) => criarReq({ body: { plano_id: 9, mac: MAC_OUTRO, ip: '10.0.0.5', cliente_id: 77, ...extra } });
const reqCartao = (extra = {}) => criarReq({ body: {
  card_number: '4509953566233704', cardholder_name: 'Fulano', expiration_month: '11', expiration_year: '2030',
  security_code: '123', identification_number: CPF, plano_id: 9, mac: MAC_OUTRO, ip: '10.0.0.5', cliente_id: 77, ...extra } });

for (const [nome, chamar] of [['PIX', (m, r, s) => m.gerarPagamento(r, s)], ['cartao', (m, r, s) => m.gerarPagamentoCartao(r, s)]]) {
  const mkReq = nome === 'PIX' ? reqPix : reqCartao;

  test(`${nome}: CPF com acesso ativo em OUTRO aparelho => 409 e nada e' gravado nem cobrado`, async () => {
    const { db, mod } = montar({ saldo: true });
    const res = criarRes(); const un = silencia();
    try { await chamar(mod, mkReq(), res); } finally { un(); }
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.requer_data_nascimento, true);
    assert.ok(!inseriu(db), 'nao cria pagamento');
  });

  test(`${nome}: mesmo aparelho do cadastro (MAC do lead) => segue para o pagamento`, async () => {
    const { db, mod } = montar({ saldo: true });
    const res = criarRes(); const un = silencia();
    try { await chamar(mod, mkReq({ mac: MAC_DONO.toUpperCase() }), res); } finally { un(); }
    assert.notStrictEqual(res.statusCode, 409);
    assert.ok(inseriu(db));
  });

  test(`${nome}: sem acesso ativo (nada a proteger) => segue mesmo de outro aparelho`, async () => {
    const { db, mod } = montar({ saldo: false });
    const res = criarRes(); const un = silencia();
    try { await chamar(mod, mkReq(), res); } finally { un(); }
    assert.notStrictEqual(res.statusCode, 409);
    assert.ok(inseriu(db));
  });

  test(`${nome}: CPF com acesso ativo mas sem nenhum lead registrado => 409 (nao ha dono para provar)`, async () => {
    const { db, mod } = montar({ saldo: true, leadsDoCpf: [] });
    const res = criarRes(); const un = silencia();
    try { await chamar(mod, mkReq(), res); } finally { un(); }
    assert.strictEqual(res.statusCode, 409);
    assert.ok(!inseriu(db));
  });
}

test('PIX: cpf vindo direto no corpo (sem passar pelo cadastro) tambem e verificado', async () => {
  const { db, mod } = montar({ saldo: true, leadPorId: null });
  const res = criarRes(); const un = silencia();
  try { await mod.gerarPagamento(reqPix({ cliente_id: undefined, cpf: CPF }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!inseriu(db));
});

test('PIX: o lead de cliente_id e buscado so na empresa do plano (cliente_id e sequencial)', async () => {
  const { db, mod } = montar({ saldo: false });
  const un = silencia();
  try { await mod.gerarPagamento(reqPix(), criarRes()); } finally { un(); }
  const q = db.calls.find((c) => /FROM leads WHERE id/.test(c.sql));
  assert.match(q.sql, /empresa_id = \?/);
  assert.deepStrictEqual(q.params, [77, 5]);
});

test('sem CPF o username e o MAC do aparelho: a trava nao se aplica', async () => {
  const { db, mod } = montar({ saldo: true, leadPorId: null });
  const res = criarRes(); const un = silencia();
  try { await mod.gerarPagamento(reqPix({ cliente_id: undefined, cpf: undefined }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(inseriu(db));
});
