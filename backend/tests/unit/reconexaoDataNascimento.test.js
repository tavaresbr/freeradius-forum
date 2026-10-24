// Segundo fator (data de nascimento) nas rotas de reconexao por CPF, com db mockado.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const limparCache = () => {
  for (const f of ['src/utils/leadUtils.js', 'src/utils/dobTentativas.js']) delete require.cache[require.resolve(path.join(ROOT, f))];
};
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

const CPF = '529.982.247-25';
const PLANO = { id: 9, duracao_minutos: 5, velocidade_down: 2, velocidade_up: 1, mikrotik_id: 3, shared_users: 1, end_hotspot: 'hs.local' };

// dob: { total, iguais } devolvido pelo COUNT; saldo: true => radcheck com Max-All-Session sobrando
function montarDb({ existing, dob = { total: 0, iguais: 0 }, saldo = false, senhaSalva = 'senhaReal9' } = {}) {
  return criarDb(async (sql) => {
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ empresa_id: 5 }]];
    if (/FROM mikrotiks WHERE empresa_id/.test(sql)) return [[{ id: 3, end_hotspot: 'hs.local', ip: '10.0.0.1' }]];
    if (/FROM planos/.test(sql)) return [[PLANO]];
    if (/COUNT\(\*\) AS total/.test(sql)) return [[dob]];
    if (/FROM leads WHERE REPLACE/.test(sql)) return [existing ? [existing] : []];
    if (/SELECT attribute, value FROM radcheck/.test(sql)) {
      return [saldo ? [
        { attribute: 'Cleartext-Password', value: senhaSalva },
        { attribute: 'Max-All-Session', value: '300' },
      ] : []];
    }
    if (/FROM radacct/.test(sql)) return [[{ usado: 0 }]];
    return undefined;
  });
}

function carregarCtrl(rel, db) {
  limparCache();
  return carregar(rel, {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({ apMac: null, ssid: null }) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
    },
  });
}

const sqls = (db) => db.calls.map((c) => c.sql);
const houve = (db, re) => sqls(db).some((s) => re.test(s));

// ---------- utilitarios ----------
test('dobTentativas: bloqueia apos 10 falhas por CPF (mesmo trocando de dispositivo)', () => {
  limparCache();
  const t = require('../../src/utils/dobTentativas');
  t._resetar();
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(t.bloqueado({ empresaId: 5, cpf: CPF, ip: `1.1.1.${i}`, mac: `aa:bb:cc:dd:ee:0${i}` }), false);
    t.registrarFalha({ empresaId: 5, cpf: CPF, ip: `1.1.1.${i}`, mac: `aa:bb:cc:dd:ee:0${i}` });
  }
  assert.strictEqual(t.bloqueado({ empresaId: 5, cpf: '52998224725', ip: '9.9.9.9', mac: '' }), true);
  assert.strictEqual(t.bloqueado({ empresaId: 6, cpf: CPF, ip: '9.9.9.8', mac: '' }), false, 'outra empresa nao e afetada');
});

test('dobTentativas: expira apos a janela', () => {
  limparCache();
  const t = require('../../src/utils/dobTentativas');
  t._resetar();
  const ctx = { empresaId: 5, cpf: CPF, ip: '1.1.1.1', mac: '' };
  const agora = Date.now();
  for (let i = 0; i < 10; i++) t.registrarFalha(ctx, agora);
  assert.strictEqual(t.bloqueado(ctx, agora + 1000), true);
  assert.strictEqual(t.bloqueado(ctx, agora + 61 * 60 * 1000), false);
});

test('usernamePertenceAoLead: telefone, e-mail ou MAC do proprio lead', () => {
  limparCache();
  const { usernamePertenceAoLead: u } = carregar('src/utils/leadUtils.js', { db: criarDb() });
  const lead = { telefone: '(55) 99999-1111', email: 'Ana@x.com', mac: 'AA:BB:CC:DD:EE:FF' };
  assert.strictEqual(u(lead, '5599999111'.slice(0, 0) + '55999991111'), true);
  assert.strictEqual(u(lead, 'ana@x.com'), true);
  assert.strictEqual(u(lead, 'aa:bb:cc:dd:ee:ff'), true);
  assert.strictEqual(u(lead, '55888882222'), false);
  assert.strictEqual(u(lead, ''), false);
  assert.strictEqual(u(null, 'x'), false);
});

test('conferirDataNascimento: ausente / ok / divergente / sem data informada / bloqueado', async () => {
  const run = async (dob, data) => {
    limparCache();
    const m = carregar('src/utils/leadUtils.js', { db: montarDb({ dob }) });
    return m.conferirDataNascimento(CPF, 5, data, { mac: 'aa:bb:cc:dd:ee:ff', ip: '1.2.3.4' });
  };
  const un = silencia();
  try {
    assert.strictEqual(await run({ total: 0, iguais: 0 }, '01/02/1990'), 'ausente');
    assert.strictEqual(await run({ total: 1, iguais: 1 }, '01/02/1990'), 'ok');
    assert.strictEqual(await run({ total: 1, iguais: 0 }, '01/02/1990'), 'divergente');
    assert.strictEqual(await run({ total: 1, iguais: 1 }, ''), 'divergente', 'sem data nao passa');
    assert.strictEqual(await run({ total: 1, iguais: 1 }, '99/99/9999'), 'divergente', 'data invalida nao passa');
    // 10 falhas seguidas => bloqueado, mesmo com a data certa
    limparCache();
    const m = carregar('src/utils/leadUtils.js', { db: montarDb({ dob: { total: 1, iguais: 0 } }) });
    const ctx = { mac: 'aa:bb:cc:dd:ee:01', ip: '5.5.5.5' };
    for (let i = 0; i < 10; i++) await m.conferirDataNascimento(CPF, 5, '01/02/1990', ctx);
    assert.strictEqual(await m.conferirDataNascimento(CPF, 5, '01/02/1990', ctx), 'bloqueado');
  } finally { un(); }
});

// ---------- /api/lgpd/login ----------
const corpoLgpd = (extra = {}) => ({ cpf: CPF, aceite: true, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', nome: 'Outra Pessoa', telefone: '11999990000', email: 'o@x.com', mikrotik_id: 3, ...extra });
const EXISTING = { id: 77, nome: 'Titular', email: 't@x.com', telefone: '55999991111', cpf: '52998224725', mac: 'aa:bb:cc:dd:ee:ff', origem: 'lgpd' };

test('lgpdLogin: data divergente => 403, sem credenciais, sem alterar cadastro nem RADIUS', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/01/2000' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.requer_data_nascimento, true);
  assert.ok(!res.body.password && !res.body.username);
  assert.ok(!houve(db, /UPDATE leads SET nome/), 'nao troca contato do titular');
  assert.ok(!houve(db, /FROM radcheck/), 'nao consulta credencial');
  assert.ok(!houve(db, /INSERT INTO radcheck|DELETE FROM radcheck/), 'nao mexe no RADIUS');
});

test('lgpdLogin: data correta + saldo => devolve credenciais do titular', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.existente, true);
  assert.strictEqual(res.body.username, '52998224725');
  assert.strictEqual(res.body.password, 'senhaReal9');
});

test('lgpdLogin: cadastro legado sem data + saldo ativo => 409, sem credenciais nem tocar no RADIUS', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9'));
  assert.ok(!houve(db, /DELETE FROM (radcheck|radreply|radusergroup)/), 'plano do titular preservado');
  assert.ok(!houve(db, /INSERT INTO (radcheck|radreply|radusergroup)/));
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(upd, 'registra o novo aceite');
  assert.ok(!upd.params.includes('11999990000') && !upd.params.includes('o@x.com'), 'contato do titular preservado');
});

test('lgpdLogin: cadastro legado sem data + SEM saldo => renova (franquia esgotada segue livre)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(houve(db, /INSERT INTO radcheck/));
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(!upd.params.includes('11999990000'), 'contato do titular preservado');
});

test('lgpdLogin: CPF sem lead mas username ja com saldo ativo => 409 e nao cria lead', async () => {
  const db = montarDb({ existing: null, saldo: true, senhaSalva: 'senhaDeOutro' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!houve(db, /INSERT INTO leads/));
  assert.ok(!houve(db, /DELETE FROM radcheck|INSERT INTO radcheck/));
});

test('lgpdLogin: titular verificado, sem saldo => re-libera normalmente', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('lgpdLogin: sem CPF (username = MAC do aparelho) nao e afetado pela trava', async () => {
  const db = montarDb({ existing: null, saldo: true });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ cpf: '' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('lgpdLogin: bloqueado por excesso de tentativas => 429', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const un = silencia(); let res;
  try {
    for (let i = 0; i < 11; i++) {
      res = criarRes();
      await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/01/2000' }), ip: '7.7.7.7' }), res);
    }
  } finally { un(); }
  assert.strictEqual(res.statusCode, 429);
});

// ---------- /api/clientes/cadastro ----------
const corpoCliente = (extra = {}) => ({ nome: 'Outra Pessoa', email: 'o@x.com', telefone: '11999990000', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, ...extra });

test('cadastroCliente: data divergente => 403 sem expor nome/e-mail do titular', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/01/2000' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!JSON.stringify(res.body).includes('Titular') && !JSON.stringify(res.body).includes('t@x.com'));
  assert.ok(!houve(db, /UPDATE leads SET nome/));
});

test('cadastroCliente: data correta + saldo => auto-login com a senha real', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.planoAtivo, true);
  assert.strictEqual(res.body.password, 'senhaReal9');
  assert.ok(houve(db, /UPDATE leads SET nome/), 'verificado pode atualizar contato');
});

test('cadastroCliente: legado sem data => segue para planos sem credenciais nem PII do titular', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.planoAtivo, false);
  assert.ok(!res.body.password && !res.body.username);
  assert.strictEqual(res.body.nome, 'Outra Pessoa');
  assert.ok(!houve(db, /UPDATE leads SET nome/), 'nao troca contato do titular');
});

// ---------- /api/lead-portal/login ----------
test('leadLogin: data correta mas username (telefone) de OUTRA pessoa com saldo => 409, senha dele intacta', async () => {
  const existing = { ...EXISTING, telefone: '55999991111' };
  const db = montarDb({ existing, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaDaVitima' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', email: '', telefone: '11888887777', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '01/02/1990' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!JSON.stringify(res.body).includes('senhaDaVitima'));
  assert.ok(!houve(db, /DELETE FROM (radcheck|radreply|radusergroup)/));
});

test('leadLogin: sem CPF, telefone que ja tem saldo ativo => 409 (nao sobrescreve a senha de quem tem o numero)', async () => {
  const db = montarDb({ existing: null, saldo: true, senhaSalva: 'senhaDoDono' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '11888887777', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3 }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!houve(db, /DELETE FROM radcheck|INSERT INTO radcheck/));
});

test('leadLogin: titular verificado com o proprio telefone, sem saldo => re-libera', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: false });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '55999991111', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '01/02/1990' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('leadLogin: data divergente => 403', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '55999991111', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '09/09/1999' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!houve(db, /INSERT INTO radcheck/));
});
