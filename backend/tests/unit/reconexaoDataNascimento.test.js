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
function montarDb({ existing, dob = { total: 0, iguais: 0 }, saldo = false, senhaSalva = 'senhaReal9', confirmado = true, dispositivoUsou = false, planoDoAcesso = null } = {}) {
  return criarDb(async (sql) => {
    // este aparelho (MAC) ja conectou com o username? / qual plano e' o acesso ativo (LGPD/Lead = gratis)
    if (/FROM radacct WHERE username = \? AND LOWER/.test(sql)) return [dispositivoUsou ? [{ 1: 1 }] : []];
    if (/FROM radius_users ru JOIN planos/.test(sql)) return [planoDoAcesso ? [{ nome: planoDoAcesso }] : []];
    // confirmado = existe pagamento aprovado com o CPF (cadastro NAO provisorio)
    if (/FROM pagamentos/.test(sql)) return [confirmado ? [{ 1: 1 }] : []];
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

function carregarCtrl(rel, db, extrasMais = {}) {
  limparCache();
  return carregar(rel, {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({ apMac: null, ssid: null }) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      ...extrasMais,
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

test('cadastroCliente: auto-login com sessao aberta em outro aparelho => requer_desconexao (credenciais seguem na resposta)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9' });
  let chamado = null;
  const ctrl = carregarCtrl('src/controllers/leadController.js', db, {
    'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async (a) => { chamado = a; return { requer_desconexao: true, sessao_ativa: { desde: null, aparelho: '…64:F4' } }; } },
  });
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.planoAtivo, true);
  assert.strictEqual(res.body.requer_desconexao, true);
  assert.strictEqual(res.body.username, '52998224725');
  assert.deepStrictEqual(chamado, { username: '52998224725', mac: 'AA:BB:CC:DD:EE:01', empresaId: 5 });
});

test('cadastroCliente: legado sem data, SEM acesso ativo => segue para planos sem credenciais nem PII do titular', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: false });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.planoAtivo, false);
  assert.ok(!res.body.password && !res.body.username);
  assert.strictEqual(res.body.nome, 'Outra Pessoa');
  assert.ok(!houve(db, /UPDATE leads SET nome/), 'nao troca contato do titular');
});

test('cadastroCliente: legado sem data + acesso ativo em OUTRO aparelho => 409 (nem chega nos planos)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.requer_data_nascimento, true);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9') && !JSON.stringify(res.body).includes('Titular'));
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

// ---------- grilagem de CPF: cadastro provisorio (sem pagamento aprovado) ----------
// UPDATE da reivindicacao (sobrescreve a data). O de gravarDataNascimento so preenche data NULL.
const dataDoUpdate = (db) => db.calls.find((c) => /UPDATE leads SET data_nascimento/.test(c.sql) && !/data_nascimento IS NULL/.test(c.sql));

test('conferirDataNascimento: CPF sem pagamento + outra data => reivindicado (troca a data e conta como tentativa)', async () => {
  limparCache();
  const db = montarDb({ dob: { total: 1, iguais: 0 }, confirmado: false });
  const m = carregar('src/utils/leadUtils.js', { db });
  const un = silencia(); let r;
  try { r = await m.conferirDataNascimento(CPF, 5, '01/02/1990', { mac: 'aa:bb:cc:dd:ee:01', ip: '5.5.5.5' }); } finally { un(); }
  assert.strictEqual(r, 'reivindicado');
  const upd = dataDoUpdate(db);
  assert.ok(upd, 'grava a data nova');
  assert.strictEqual(upd.params[0], '1990-02-01');
  assert.match(upd.sql, /empresa_id = \?/);
});

test('conferirDataNascimento: CPF COM pagamento aprovado continua trancado (divergente) e nao troca a data', async () => {
  limparCache();
  const db = montarDb({ dob: { total: 1, iguais: 0 }, confirmado: true });
  const m = carregar('src/utils/leadUtils.js', { db });
  const un = silencia(); let r;
  try { r = await m.conferirDataNascimento(CPF, 5, '01/02/1990', { mac: 'aa:bb:cc:dd:ee:01', ip: '5.5.5.5' }); } finally { un(); }
  assert.strictEqual(r, 'divergente');
  assert.ok(!dataDoUpdate(db));
});

test('conferirDataNascimento: sem data informada nao reivindica nada (continua divergente)', async () => {
  limparCache();
  const db = montarDb({ dob: { total: 1, iguais: 0 }, confirmado: false });
  const m = carregar('src/utils/leadUtils.js', { db });
  const un = silencia(); let r;
  try { r = await m.conferirDataNascimento(CPF, 5, '', { mac: 'aa:bb:cc:dd:ee:01', ip: '5.5.5.5' }); } finally { un(); }
  assert.strictEqual(r, 'divergente');
  assert.ok(!dataDoUpdate(db));
});

test('cpfConfirmado: so pagamento approved/expirado da empresa; erro de banco => confirmado (lado seguro)', async () => {
  limparCache();
  const db = montarDb({ confirmado: true });
  const m = carregar('src/utils/leadUtils.js', { db });
  assert.strictEqual(await m.cpfConfirmado('52998224725', 5), true);
  const q = db.calls.find((c) => /FROM pagamentos/.test(c.sql));
  assert.match(q.sql, /status IN \('approved', 'expirado'\)/);
  assert.match(q.sql, /empresa_id = \?/);
  assert.match(q.sql, /metodo_pagamento <> 'cartao'/, 'cartao (CPF digitado, nao verificavel) nao confirma o CPF');
  assert.match(q.sql, /pagador_cpf IS NULL OR \? LIKE REPLACE\(pagador_cpf, '\*', '_'\)/, 'o pagador tem que ser o dono do CPF (ou desconhecido)');
  assert.deepStrictEqual(q.params, ['52998224725', '52998224725', 5]);
  limparCache();
  const quebrado = criarDb(async () => { throw new Error('db fora'); });
  const m2 = carregar('src/utils/leadUtils.js', { db: quebrado });
  const un = silencia(); let r;
  try { r = await m2.cpfConfirmado('52998224725', 5); } finally { un(); }
  assert.strictEqual(r, true);
});

test('lgpdLogin: CPF grilado (sem pagamento): o dono de verdade NAO e trancado; contato e data passam a ser dele', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: false, confirmado: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 403);
  assert.ok(dataDoUpdate(db), 'data do dono gravada');
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(upd.params.includes('11999990000'), 'contato passa a ser o de quem se cadastrou agora');
  assert.ok(houve(db, /INSERT INTO radcheck/), 'e recebe acesso novo');
});

test('lgpdLogin: reivindicar NAO entrega credenciais existentes: com acesso ativo => 409 e RADIUS intacto', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9'));
  assert.ok(!houve(db, /DELETE FROM (radcheck|radreply|radusergroup)/));
});

test('lgpdLogin: CPF sem pagamento mas SEM data informada => 403 (so reivindica quem informa uma data)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: false, confirmado: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd(), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!dataDoUpdate(db));
});

test('cadastroCliente: CPF sem pagamento + data diferente => reivindica, sem credenciais nem dados do cadastro anterior', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.planoAtivo, false);
  assert.strictEqual(res.body.nome, 'Outra Pessoa');
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9') && !JSON.stringify(res.body).includes('Titular'));
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(upd.params.includes('11999990000'), 'o telefone do cadastro passa a ser o de quem vai pagar (WhatsApp vai pra ele)');
  assert.ok(dataDoUpdate(db));
});

test('cadastroCliente: cadastro legado sem data e sem pagamento tambem e reivindicado (contato vira o de quem vai pagar)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 0, iguais: 0 }, saldo: false, confirmado: false });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.planoAtivo, false);
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(upd && upd.params.includes('11999990000'));
  assert.ok(dataDoUpdate(db), 'grava a data informada');
});

test('cadastroCliente: CPF COM pagamento aprovado e outra data => 403 e nada muda', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true, confirmado: true });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!dataDoUpdate(db));
  assert.ok(!houve(db, /UPDATE leads SET nome/));
});

test('leadLogin: reivindicar atualiza o contato mas nao devolve credenciais', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: false, confirmado: false });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '11888887777', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '01/02/1990' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.notStrictEqual(res.statusCode, 403);
  assert.notStrictEqual(res.body && res.body.existente, true);
  const upd = db.calls.find((c) => /UPDATE leads SET nome/.test(c.sql));
  assert.ok(upd && upd.params.includes('11888887777'));
});

test('reivindicar tem limite: 10 trocas/hora no mesmo CPF => depois 429', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: false, confirmado: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const un = silencia(); let res;
  try {
    for (let i = 0; i < 11; i++) {
      res = criarRes();
      await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: `0${(i % 9) + 1}/02/1990` }), ip: '7.7.7.7' }), res);
    }
  } finally { un(); }
  assert.strictEqual(res.statusCode, 429);
});

// ---------- acesso gratis exposto: data gravada por quem reivindica nao libera credenciais ----------
test('lgpdLogin: CPF sem pagamento, data "ok" mas aparelho NUNCA usou o acesso => credenciais antigas NAO voltam (re-libera com senha nova)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou: false, planoDoAcesso: 'LGPD' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.notStrictEqual(res.body.existente, true);
  assert.ok(res.body.password && res.body.password !== 'senhaReal9', 'senha nova, nunca a antiga');
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('lgpdLogin: CPF sem pagamento, data "ok" e o aparelho JA usou o acesso => credenciais voltam (reconexao do dono)', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou: true, planoDoAcesso: 'LGPD' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.existente, true);
  assert.strictEqual(res.body.password, 'senhaReal9');
  assert.ok(!houve(db, /INSERT INTO radcheck/), 'nao renova a franquia de quem so reconectou');
});

test('lgpdLogin: CPF COM pagamento: a data basta (trava rigida) mesmo em aparelho novo', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: true, dispositivoUsou: false });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.existente, true);
  assert.strictEqual(res.body.password, 'senhaReal9');
});

test('lgpdLogin: acesso ativo que NAO e o plano gratis (admin/pago) + aparelho que nunca o usou => 409 e RADIUS intacto', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou: false, planoDoAcesso: 'Plano 30 dias' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 409);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9'));
  assert.ok(!houve(db, /DELETE FROM (radcheck|radreply|radusergroup)/));
});

test('lgpdLogin: reivindicar em acesso gratis ativo agora RE-LIBERA (nao tranca o dono) e nunca devolve a senha antiga', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 0 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, planoDoAcesso: 'Lead' });
  const ctrl = carregarCtrl('src/controllers/lgpdController.js', db);
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.notStrictEqual(res.statusCode, 409);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9'));
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('lgpdLogin: re-liberacao com sessao aberta em OUTRO aparelho => resposta traz o aviso para desconectar', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: false, confirmado: true });
  limparCache();
  const ctrl = carregar('src/controllers/lgpdController.js', {
    db,
    extras: {
      'src/utils/apInfo.js': { resolverApDoContexto: async () => ({ apMac: null, ssid: null }) },
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async () => ({ requer_desconexao: true, sessao_ativa: { aparelho: 'ee:ff' } }) },
    },
  });
  const res = criarRes(); const un = silencia();
  try { await ctrl.lgpdLogin(criarReq({ body: corpoLgpd({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
  assert.strictEqual(res.body.requer_desconexao, true);
  assert.ok(res.body.password);
});

test('leadLogin: CPF sem pagamento, data "ok" mas aparelho nunca usou o acesso => credenciais antigas NAO voltam', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou: false, planoDoAcesso: 'Lead' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '55999991111', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '01/02/1990' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.notStrictEqual(res.body.existente, true);
  assert.ok(!JSON.stringify(res.body).includes('senhaReal9'));
  assert.ok(houve(db, /INSERT INTO radcheck/));
});

test('leadLogin: CPF sem pagamento e aparelho que ja usou o acesso => credenciais voltam', async () => {
  const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou: true, planoDoAcesso: 'Lead' });
  const ctrl = carregarCtrl('src/controllers/leadController.js', db);
  const res = criarRes(); const un = silencia();
  try {
    await ctrl.leadLogin(criarReq({ body: { nome: 'X', telefone: '55999991111', cpf: CPF, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3, data_nascimento: '01/02/1990' }, ip: '7.7.7.7' }), res);
  } finally { un(); }
  assert.strictEqual(res.body.existente, true);
  assert.strictEqual(res.body.password, 'senhaReal9');
});

test('cadastroCliente: CPF sem pagamento, data "ok", aparelho nunca usou o acesso => segue para planos sem credenciais; se ja usou => auto-login', async () => {
  for (const [dispositivoUsou, esperaAtivo] of [[false, false], [true, true]]) {
    const db = montarDb({ existing: EXISTING, dob: { total: 1, iguais: 1 }, saldo: true, senhaSalva: 'senhaReal9', confirmado: false, dispositivoUsou });
    const ctrl = carregarCtrl('src/controllers/leadController.js', db);
    const res = criarRes(); const un = silencia();
    try { await ctrl.cadastroCliente(criarReq({ body: corpoCliente({ data_nascimento: '01/02/1990' }), ip: '7.7.7.7' }), res); } finally { un(); }
    assert.strictEqual(res.body.planoAtivo, esperaAtivo, `dispositivoUsou=${dispositivoUsou}`);
    assert.strictEqual(!!res.body.password, esperaAtivo);
  }
});

test('bloqueiaReliberacao: acesso gratis (LGPD/Lead) pode ser regravado; pago/admin ou sem registro continua protegido', async () => {
  const run = async (planoDoAcesso, saldo) => {
    limparCache();
    const m = carregar('src/utils/leadUtils.js', { db: montarDb({ saldo, planoDoAcesso }) });
    return m.bloqueiaReliberacao({ username: '52998224725', titularVerificado: false });
  };
  assert.strictEqual(await run('LGPD', true), false);
  assert.strictEqual(await run('lead', true), false);
  assert.strictEqual(await run('Plano 30 dias', true), true);
  assert.strictEqual(await run(null, true), true);
  assert.strictEqual(await run('Plano 30 dias', false), false, 'sem saldo ativo nada a proteger');
});

test('dispositivoJaUsouAcesso: compara o MAC normalizado no radacct do username; MAC invalido nem consulta', async () => {
  limparCache();
  const db = montarDb({ dispositivoUsou: true });
  const m = carregar('src/utils/leadUtils.js', { db });
  assert.strictEqual(await m.dispositivoJaUsouAcesso('52998224725', 'AA-BB-CC-DD-EE-FF'), true);
  const q = db.calls.find((c) => /FROM radacct WHERE username/.test(c.sql));
  assert.deepStrictEqual(q.params, ['52998224725', 'aabbccddeeff']);
  const antes = db.calls.length;
  assert.strictEqual(await m.dispositivoJaUsouAcesso('52998224725', 'xx'), false);
  assert.strictEqual(db.calls.length, antes);
});

test('podeReceberCredenciais: CPF confirmado basta (nem consulta o radacct); senao exige o aparelho', async () => {
  limparCache();
  const db = montarDb({ confirmado: true });
  const m = carregar('src/utils/leadUtils.js', { db });
  assert.strictEqual(await m.podeReceberCredenciais({ cpf: CPF, username: '52998224725', mac: 'aa:bb:cc:dd:ee:01', empresaId: 5 }), true);
  assert.ok(!db.calls.some((c) => /FROM radacct/.test(c.sql)));
  limparCache();
  const db2 = montarDb({ confirmado: false, dispositivoUsou: false });
  const m2 = carregar('src/utils/leadUtils.js', { db: db2 });
  assert.strictEqual(await m2.podeReceberCredenciais({ cpf: CPF, username: '52998224725', mac: 'aa:bb:cc:dd:ee:01', empresaId: 5 }), false);
});

// ---------- CPF invalido (digitos verificadores) barrado no servidor em todo cadastro publico ----------
test('cadastros publicos: CPF com digito verificador errado => 400 e nada gravado', async () => {
  const CPF_RUIM = '529.982.247-26';
  const casos = [
    ['src/controllers/lgpdController.js', 'lgpdLogin', { cpf: CPF_RUIM, aceite: true, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3 }],
    ['src/controllers/lgpdController.js', 'lgpdCadastro', { cpf: CPF_RUIM, aceite: true, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3 }],
    ['src/controllers/leadController.js', 'leadLogin', { cpf: CPF_RUIM, telefone: '11999990000', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3 }],
    ['src/controllers/leadController.js', 'capturaPassiva', { cpf: CPF_RUIM, telefone: '11999990000', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', mikrotik_id: 3 }],
    ['src/controllers/leadController.js', 'cadastroCliente', corpoCliente({ cpf: CPF_RUIM })],
  ];
  for (const [arq, fn, body] of casos) {
    const db = montarDb();
    const ctrl = carregarCtrl(arq, db);
    const res = criarRes(); const un = silencia();
    try { await ctrl[fn](criarReq({ body, ip: '7.7.7.7' }), res); } finally { un(); }
    assert.strictEqual(res.statusCode, 400, `${fn} deve recusar`);
    assert.ok(!houve(db, /INSERT INTO (leads|radcheck)|UPDATE leads/), `${fn} nao grava nada`);
  }
});
