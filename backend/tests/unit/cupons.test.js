// Cupom de desconto: validacao, calculo no servidor, uso idempotente, PIX/cartao e admin.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const cup = require('../../src/utils/cupons');

const ROOT = path.resolve(__dirname, '..', '..');
const PLANO = { id: 9, empresa_id: 5, nome: 'Plano 1h', valor: 1000, duracao_minutos: 60, mikrotik_id: 3 };
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const limparSrc = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };

test('validarCupomAdmin: codigo, tipo, percentual 1-99, datas e limites', () => {
  const ok = cup.validarCupomAdmin({ codigo: ' ola10 ', tipo: 'percentual', valor: 10, plano_id: '', valido_ate: '2026-12-31', max_usos: 50 });
  assert.deepStrictEqual([ok.codigo, ok.plano_id, ok.valido_ate, ok.max_usos, ok.ativo], ['OLA10', null, '2026-12-31', 50, 1]);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'a b', tipo: 'valor', valor: 100 }), /Código/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'AB', tipo: 'valor', valor: 100 }), /Código/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'OK1', tipo: 'xx', valor: 10 }), /Tipo/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'OK1', tipo: 'percentual', valor: 100 }), /1% a 99%/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'OK1', tipo: 'percentual', valor: 0 }), /valor do desconto/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'OK1', tipo: 'valor', valor: 10, valido_ate: '31/12/2026' }), /Data/);
  assert.throws(() => cup.validarCupomAdmin({ codigo: 'OK1', tipo: 'valor', valor: 10, max_usos: 0 }), /Limite/);
});

test('calcularDesconto: percentual e valor fixo, minimo R$ 1,00, plano barato nao recebe', () => {
  assert.deepStrictEqual(cup.calcularDesconto(1000, { tipo: 'percentual', valor: 10 }), { desconto: 100, valor_final: 900 });
  assert.deepStrictEqual(cup.calcularDesconto(1000, { tipo: 'valor', valor: 300 }), { desconto: 300, valor_final: 700 });
  assert.strictEqual(cup.calcularDesconto(1000, { tipo: 'valor', valor: 5000 }).valor_final, 100, 'nunca abaixo de R$ 1,00');
  assert.strictEqual(cup.calcularDesconto(1000, { tipo: 'percentual', valor: 99 }).valor_final, 100);
  assert.deepStrictEqual(cup.calcularDesconto(100, { tipo: 'valor', valor: 50 }), { desconto: 0, valor_final: 100 });
  assert.deepStrictEqual(cup.calcularDesconto(0, { tipo: 'percentual', valor: 10 }), { desconto: 0, valor_final: 0 });
});

// ---------- resolverCupom ----------
const CUPOM = { id: 3, empresa_id: 5, codigo: 'OLA10', tipo: 'percentual', valor: 10, plano_id: null, max_usos: null, usos: 0 };
function resolver({ cupom = CUPOM, jaUsou = false, temCol = true, plano = PLANO, codigo = 'ola10', cpf = '52998224725' } = {}) {
  limparSrc();
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: temCol ? 1 : 0 }]];
    if (/FROM cupons/.test(sql)) return [cupom ? [cupom] : []];
    if (/FROM pagamentos WHERE empresa_id = \? AND cupom_id/.test(sql)) return [jaUsou ? [{ id: 1 }] : []];
  });
  const mod = carregar('src/utils/cupons.js', { db });
  return mod.resolverCupom({ empresaId: 5, plano, codigo, cpf }).then((r) => ({ r, db }));
}

test('resolverCupom: aplica o desconto (codigo normalizado) e consulta sempre com empresa_id', async () => {
  const { r, db } = await resolver();
  assert.deepStrictEqual([r.ok, r.valor_original, r.desconto, r.valor_final], [true, 1000, 100, 900]);
  const q = db.calls.find((c) => /FROM cupons/.test(c.sql));
  assert.match(q.sql, /empresa_id = \?/);
  assert.match(q.sql, /ativo = 1/);
  assert.deepStrictEqual(q.params, [5, 'OLA10']);
});

test('resolverCupom: inexistente, outro plano, esgotado, CPF que ja usou, plano de outra empresa e sem migration => recusa igual', async () => {
  assert.deepStrictEqual((await resolver({ cupom: null })).r, { ok: false });
  assert.deepStrictEqual((await resolver({ cupom: { ...CUPOM, plano_id: 99 } })).r, { ok: false });
  assert.deepStrictEqual((await resolver({ cupom: { ...CUPOM, max_usos: 5, usos: 5 } })).r, { ok: false });
  assert.strictEqual((await resolver({ cupom: { ...CUPOM, max_usos: 5, usos: 4 } })).r.ok, true);
  assert.deepStrictEqual((await resolver({ jaUsou: true })).r, { ok: false });
  assert.deepStrictEqual((await resolver({ plano: { ...PLANO, empresa_id: 6 } })).r, { ok: false });
  assert.deepStrictEqual((await resolver({ temCol: false })).r, { ok: false });
  assert.deepStrictEqual((await resolver({ codigo: "' OR 1=1 --" })).r, { ok: false });
});

test('registrarUsoCupom: conta 1 vez por pagamento (idempotente) e ignora pagamento sem cupom', async () => {
  limparSrc();
  let ins = 1;
  const db = criarDb(async (sql) => {
    if (/SELECT empresa_id, cupom_id FROM pagamentos/.test(sql)) return [[{ empresa_id: 5, cupom_id: 3 }]];
    if (/INSERT IGNORE INTO cupom_usos/.test(sql)) return [{ affectedRows: ins }];
  });
  const mod = carregar('src/utils/cupons.js', { db });
  assert.strictEqual(await mod.registrarUsoCupom(50), true);
  const up = db.calls.find((c) => /UPDATE cupons SET usos = usos \+ 1/.test(c.sql));
  assert.deepStrictEqual(up.params, [3, 5]);
  ins = 0; db.calls.length = 0;
  assert.strictEqual(await mod.registrarUsoCupom(50), false);
  assert.ok(!db.calls.some((c) => /UPDATE cupons/.test(c.sql)), 'repeticao nao soma de novo');
  const sem = carregar('src/utils/cupons.js', { db: criarDb(async (sql) => (/FROM pagamentos/.test(sql) ? [[{ empresa_id: 5, cupom_id: null }]] : undefined)) });
  assert.strictEqual(await sem.registrarUsoCupom(51), false);
});

// ---------- PIX e cartao: o valor cobrado vem SO do servidor ----------
function pagamento({ cupom = CUPOM, jaUsou = false } = {}) {
  limparSrc();
  const posts = [];
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: {
    get: async () => ({ data: [] }),
    post: async (url, body) => { posts.push({ url, body }); return { data: { id: 777, point_of_interaction: { transaction_data: { qr_code_base64: 'x', qr_code: 'y' } } } }; },
  } };
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM planos WHERE id/.test(sql)) return [[PLANO]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: { access_token: 'APP_USR-x', public_key: 'APP_USR-p' } }]];
    if (/FROM cupons/.test(sql)) return [cupom ? [cupom] : []];
    if (/FROM pagamentos WHERE empresa_id = \? AND cupom_id/.test(sql)) return [jaUsou ? [{ id: 1 }] : []];
    if (/INSERT INTO pagamentos/.test(sql)) return [{ insertId: 50 }];
    if (/FROM leads WHERE id = \? AND empresa_id/.test(sql)) return [[]];
    if (/SELECT attribute, value FROM radcheck/.test(sql)) return [[]];
  });
  const mod = carregar('src/controllers/pagamentoController.js', { db });
  return { db, mod, posts };
}
const reqPix = (extra = {}) => criarReq({ body: { plano_id: 9, mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', cpf: '529.982.247-25', ...extra } });

test('PIX com cupom: grava e cobra o valor com desconto calculado no servidor; valor do cliente e ignorado', async () => {
  const { db, mod, posts } = pagamento();
  const res = criarRes(); const un = silencia();
  try { await mod.gerarPagamento(reqPix({ cupom: 'ola10', valor: 1, desconto: 9999, valor_final: 1 }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 200);
  const ins = db.calls.find((c) => /INSERT INTO pagamentos/.test(c.sql));
  assert.ok(ins.params.includes(900) && !ins.params.includes(1000), 'grava o valor final em centavos');
  assert.strictEqual(posts[0].body.transaction_amount, 9);
  const up = db.calls.find((c) => /UPDATE pagamentos SET cupom_id = \?, valor_original = \?/.test(c.sql));
  assert.deepStrictEqual(up.params, [3, 1000, 50]);
});

test('PIX com cupom invalido (inexistente, de outro plano ou ja usado pelo CPF) => 400 generico, nada gravado nem cobrado', async () => {
  for (const cfg of [{ cupom: null }, { cupom: { ...CUPOM, plano_id: 99 } }, { jaUsou: true }]) {
    const { db, mod, posts } = pagamento(cfg);
    const res = criarRes(); const un = silencia();
    try { await mod.gerarPagamento(reqPix({ cupom: 'OLA10' }), res); } finally { un(); }
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, cup.MSG_INVALIDO);
    assert.ok(!db.calls.some((c) => /INSERT INTO pagamentos/.test(c.sql)));
    assert.strictEqual(posts.length, 0);
  }
});

test('PIX sem cupom continua cobrando o valor cheio do plano', async () => {
  const { db, mod, posts } = pagamento();
  const res = criarRes(); const un = silencia();
  try { await mod.gerarPagamento(reqPix(), res); } finally { un(); }
  assert.strictEqual(posts[0].body.transaction_amount, 10);
  assert.ok(!db.calls.some((c) => /SET cupom_id/.test(c.sql)));
});

test('cartao com cupom invalido => 400 antes de qualquer cobranca ou registro', async () => {
  const { db, mod, posts } = pagamento({ cupom: null });
  const res = criarRes(); const un = silencia();
  try {
    await mod.gerarPagamentoCartao(criarReq({ body: {
      card_number: '4509953566233704', cardholder_name: 'Fulano', expiration_month: '11', expiration_year: '2030',
      security_code: '123', identification_number: '529.982.247-25', plano_id: 9, mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', cupom: 'NAOEXISTE' } }), res);
  } finally { un(); }
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.message, cup.MSG_INVALIDO);
  assert.ok(!db.calls.some((c) => /INSERT INTO pagamentos/.test(c.sql)));
  assert.strictEqual(posts.length, 0);
});

// ---------- controller ----------
test('admin: criar escopa por empresa e valida o plano; duplicado 409; excluir cupom usado 409; sem migration 503', async () => {
  limparSrc();
  let usado = 0, dup = false, semTabela = false;
  const db = criarDb(async (sql) => {
    if (semTabela) { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
    if (/FROM planos WHERE id = \? AND empresa_id/.test(sql)) return [[{ id: 9 }]];
    if (/INSERT INTO cupons/.test(sql)) { if (dup) { const e = new Error('d'); e.code = 'ER_DUP_ENTRY'; throw e; } return [{ insertId: 8 }]; }
    if (/COUNT\(\*\) AS n FROM pagamentos WHERE cupom_id/.test(sql)) return [[{ n: usado }]];
    if (/DELETE FROM cupons/.test(sql)) return [{ affectedRows: 1 }];
  });
  const ctrl = carregar('src/controllers/cuponsController.js', { db });
  const corpo = { codigo: 'ola10', tipo: 'percentual', valor: 10, plano_id: 9 };
  let res = criarRes();
  await ctrl.criar(criarReq({ empresa_id: 5, body: corpo }), res);
  assert.strictEqual(res.statusCode, 201);
  const ins = db.calls.find((c) => /INSERT INTO cupons/.test(c.sql));
  assert.strictEqual(ins.params[0], 5);
  res = criarRes(); dup = true;
  await ctrl.criar(criarReq({ empresa_id: 5, body: corpo }), res);
  assert.strictEqual(res.statusCode, 409);
  res = criarRes(); usado = 2;
  await ctrl.excluir(criarReq({ empresa_id: 5, params: { id: '8' } }), res);
  assert.strictEqual(res.statusCode, 409);
  res = criarRes(); usado = 0;
  await ctrl.excluir(criarReq({ empresa_id: 5, params: { id: '8' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(db.calls.find((c) => /DELETE FROM cupons/.test(c.sql)).params, [8, 5]);
  res = criarRes(); semTabela = true; const un = silencia();
  try { await ctrl.listar(criarReq({ empresa_id: 5 }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.error, /060/);
});

test('publico: validar so devolve valores (nada gravado) e responde igual para qualquer recusa', async () => {
  limparSrc();
  let cupom = CUPOM;
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM planos WHERE id/.test(sql)) return [[PLANO]];
    if (/FROM cupons/.test(sql)) return [cupom ? [cupom] : []];
  });
  const ctrl = carregar('src/controllers/cuponsController.js', { db });
  let res = criarRes();
  await ctrl.validarPublico(criarReq({ body: { plano_id: 9, codigo: 'ola10' } }), res);
  assert.deepStrictEqual(res.body, { valor_original: 1000, desconto: 100, valor_final: 900 });
  assert.ok(!db.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)));
  cupom = null; res = criarRes();
  await ctrl.validarPublico(criarReq({ body: { plano_id: 9, codigo: 'nada' } }), res);
  assert.deepStrictEqual([res.statusCode, res.body.message], [400, cup.MSG_INVALIDO]);
  res = criarRes();
  await ctrl.validarPublico(criarReq({ body: { plano_id: 'x', codigo: 'nada' } }), res);
  assert.deepStrictEqual([res.statusCode, res.body.message], [400, cup.MSG_INVALIDO]);
});
