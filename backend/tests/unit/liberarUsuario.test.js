// Fluxo de liberacao RADIUS (mikrotikAPIController.liberarUsuario) com db mockado.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar } = require('../helpers/mocks');

const PLANO = { id: 11, nome: 'Plano 1h', empresa_id: 5, velocidade_up: 1, velocidade_down: 2, duracao_minutos: 60, mikrotik_id: 3 };

function montar({ sessaoAtiva = false, coaOk = true } = {}) {
  const notificacoes = [];
  const coaCalls = [];
  const db = criarDb(async (sql) => {
    if (/^SELECT \* FROM planos/.test(sql)) return [[PLANO]];
    if (/FROM radacct/.test(sql)) return [sessaoAtiva ? [{ 1: 1 }] : []];
    if (/FROM mikrotiks/.test(sql)) return [[{ end_hotspot: 'hotspot.local', ip: '10.0.0.1' }]];
    return undefined;
  });
  const mod = carregar('src/controllers/mikrotikAPIController.js', {
    db,
    extras: {
      'src/services/whatsappNotify.js': { notificarLiberacao: async (ctx) => { notificacoes.push(ctx); } },
      'src/utils/coa.js': { upgradeSessaoCoA: async (a) => { coaCalls.push(a); return coaOk ? { ok: true } : { ok: false, reason: 'x' }; } },
    },
  });
  const silencia = () => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; return () => { console.log = l; console.warn = w; }; };
  return { db, mod, notificacoes, coaCalls, silencia };
}
const sqlTodo = (db) => db.calls.map((c) => c.sql).join('\n');
const flat = (db) => JSON.stringify(db.calls.map((c) => c.params));

test('liberarUsuario (novo): Max-All-Session em segundos, nunca Max-Daily-Session; Simultaneous-Use=1', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'AA:BB:CC:DD:EE:FF', ip: '10.1.1.1', plano: 'Plano 1h', empresa_id: 5, cpf: '529.982.247-25' }); } finally { un(); }
  assert.ok(!/Max-Daily-Session/.test(sqlTodo(db)) && !/Max-Daily-Session/.test(flat(db)));
  const ins = db.calls.find((c) => /INSERT INTO radcheck/.test(c.sql));
  assert.ok(ins, 'INSERT radcheck');
  const u = '52998224725';
  // Senha: o codigo atual grava senha ALEATORIA (nao mais == username); o que importa e' ser nao-vazia.
  assert.ok(ins.params[3] && String(ins.params[3]).length >= 6);
  assert.deepStrictEqual(ins.params.filter((_, i) => i !== 3), [
    u, 'Cleartext-Password', ':=',
    u, 'Max-All-Session', ':=', '3600',
    u, 'Simultaneous-Use', ':=', '1',
  ]);
});

test('liberarUsuario: sem CPF usa MAC como username', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'AA:BB:CC:DD:EE:FF', plano: 'Plano 1h', empresa_id: 5 }); } finally { un(); }
  const ins = db.calls.find((c) => /INSERT INTO radcheck/.test(c.sql));
  assert.strictEqual(ins.params[0], 'AA:BB:CC:DD:EE:FF');
});

test('liberarUsuario: limpa radcheck/radreply/radusergroup antigos (por username)', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  for (const t of ['radcheck', 'radreply', 'radusergroup']) {
    const d = db.calls.find((c) => new RegExp(`^DELETE FROM ${t} WHERE username = \\?$`).test(c.sql));
    assert.ok(d, t); assert.deepStrictEqual(d.params, ['52998224725']);
  }
});

test('liberarUsuario: Mikrotik-Rate-Limit up/down + Session-Timeout + WISPr em bps', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  const r = db.calls.find((c) => /INSERT INTO radreply/.test(c.sql));
  for (const a of ['Mikrotik-Rate-Limit', 'Session-Timeout', 'WISPr-Bandwidth-Max-Up', 'WISPr-Bandwidth-Max-Down']) assert.match(r.sql, new RegExp(a));
  const u = '52998224725';
  assert.deepStrictEqual(r.params, [u, '1M/2M', u, '3600', u, '1000000', u, '2000000']);
});

test('liberarUsuario: liberado_em preenchido no INSERT radius_users (NOW + ON DUPLICATE) com empresa/plano/nas', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  const c = db.calls.find((x) => /INSERT INTO radius_users/.test(x.sql));
  assert.match(c.sql, /liberado_em/); assert.match(c.sql, /VALUES \(\?, \?, \?, \?, NOW\(\)\)/);
  assert.match(c.sql, /ON DUPLICATE KEY UPDATE .*liberado_em = NOW\(\)/);
  assert.deepStrictEqual(c.params, [5, '52998224725', 11, 3]);
});

test('liberarUsuario: grupo = id do plano', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  const g = db.calls.find((c) => /INSERT INTO radusergroup/.test(c.sql));
  assert.deepStrictEqual(g.params, ['52998224725', '11']);
});

test('liberarUsuario: plano buscado filtrando por empresa_id', async () => {
  const { db, mod, silencia } = montar(); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5 }); } finally { un(); }
  assert.match(db.calls[0].sql, /AND empresa_id = \?/); assert.deepStrictEqual(db.calls[0].params, ['Plano 1h', 5]);
});

test('liberarUsuario: plano inexistente -> lanca erro e nao grava RADIUS', async () => {
  const db = criarDb(async (s) => (/FROM planos/.test(s) ? [[]] : undefined));
  const mod = carregar('src/controllers/mikrotikAPIController.js', { db, extras: {
    'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} }, 'src/utils/coa.js': { upgradeSessaoCoA: async () => ({ ok: true }) } } });
  const e = console.error; console.error = () => {};
  try { await assert.rejects(mod.liberarUsuario({ mac: 'm', plano: 'x', empresa_id: 5 }), /não encontrado/); } finally { console.error = e; }
  assert.ok(!db.calls.some((c) => /^(INSERT|DELETE)/.test(c.sql)));
});

test('liberarUsuario: NAO apaga radacct (reset do contador e via liberado_em; historico Marco Civil preservado)', async () => {
  // Observacao: CLAUDE.md ainda descreve "DELETE FROM radacct" no modelo antigo; o codigo atual
  // usa radius_users.liberado_em e preserva o radacct. O teste fixa o comportamento vigente.
  for (const sessaoAtiva of [false, true]) {
    const { db, mod, silencia } = montar({ sessaoAtiva, coaOk: false }); const un = silencia();
    try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
    assert.ok(!db.calls.some((c) => /DELETE FROM radacct/i.test(c.sql)), `sessaoAtiva=${sessaoAtiva}`);
    assert.ok(db.calls.some((c) => /UPDATE radius_users SET liberado_em = NOW\(\)/.test(c.sql)));
  }
});

test('liberarUsuario: dispara notificarLiberacao com portal_id/empresa e a mesma senha gravada no radcheck', async () => {
  const { db, mod, notificacoes, silencia } = montar(); const un = silencia();
  let ret;
  try { ret = await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725', portal_id: 9, telefone: '5511999999999' }); } finally { un(); }
  const gravada = db.calls.find((c) => /INSERT INTO radcheck/.test(c.sql)).params[3];
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(notificacoes.length, 1);
  assert.strictEqual(notificacoes[0].portal_id, 9); assert.strictEqual(notificacoes[0].empresa_id, 5);
  assert.strictEqual(notificacoes[0].vars.username, '52998224725');
  assert.strictEqual(notificacoes[0].vars.password, gravada);
  assert.strictEqual(notificacoes[0].vars.login_url, `http://hotspot.local/login?username=52998224725&password=${gravada}`);
  if (ret) assert.deepStrictEqual(ret, { username: '52998224725', password: gravada });
});

test('liberarUsuario: falha no WhatsApp nao bloqueia a liberacao', async () => {
  const db = criarDb(async (s) => (/^SELECT \* FROM planos/.test(s) ? [[PLANO]] : /FROM mikrotiks/.test(s) ? [[{ ip: '1.1.1.1' }]] : undefined));
  const mod = carregar('src/controllers/mikrotikAPIController.js', { db, extras: {
    'src/services/whatsappNotify.js': { notificarLiberacao: async () => { throw new Error('zap off'); } },
    'src/utils/coa.js': { upgradeSessaoCoA: async () => ({ ok: true }) } } });
  const l = console.log, w = console.warn; console.log = console.warn = () => {};
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5 }); await new Promise((r) => setImmediate(r)); } finally { console.log = l; console.warn = w; }
});

test('liberarUsuario (upgrade com sessao ativa + CoA ok): mesmos atributos, sem recriar usuario', async () => {
  const { db, mod, coaCalls, silencia } = montar({ sessaoAtiva: true, coaOk: true }); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  const s = sqlTodo(db);
  assert.ok(!/Max-Daily-Session/.test(s));
  assert.match(s, /'Max-All-Session'/);
  assert.ok(db.calls.some((c) => /UPDATE radcheck SET value = '1' .*Simultaneous-Use/.test(c.sql)), 'Simultaneous-Use=1');
  const rr = db.calls.filter((c) => /radreply/.test(c.sql) && /^(UPDATE|INSERT)/.test(c.sql));
  const attrs = rr.map((c) => c.params[1] ?? c.params[2]);
  assert.ok(attrs.length >= 4);
  const ru = db.calls.find((c) => /INSERT INTO radius_users/.test(c.sql));
  assert.match(ru.sql, /NOW\(\)/); assert.match(ru.sql, /liberado_em = NOW\(\)/);
  assert.deepStrictEqual(coaCalls, [{ username: '52998224725', sessionTimeout: 3600, rateLimit: '1M/2M' }]);
  assert.ok(!db.calls.some((c) => /^DELETE FROM radcheck/.test(c.sql)), 'nao recria usuario');
});

test('liberarUsuario (upgrade): se CoA falha, cai no fluxo de recriacao completo', async () => {
  const { db, mod, silencia } = montar({ sessaoAtiva: true, coaOk: false }); const un = silencia();
  try { await mod.liberarUsuario({ mac: 'm', plano: 'Plano 1h', empresa_id: 5, cpf: '52998224725' }); } finally { un(); }
  assert.ok(db.calls.some((c) => /^DELETE FROM radcheck/.test(c.sql)));
  assert.ok(db.calls.some((c) => /INSERT INTO radcheck/.test(c.sql) && c.params.includes('Max-All-Session')));
});
