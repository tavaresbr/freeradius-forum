// Pagamento com acesso ainda ativo: o tempo restante e' somado ao do plano novo (nao perdido).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const PLANO = { id: 11, nome: 'Plano 1h', empresa_id: 5, velocidade_up: 1, velocidade_down: 2, duracao_minutos: 60, mikrotik_id: 3 };
const CPF = '529.982.247-25';
const U = '52998224725';

// saldoRestante: segundos que SOBRAM no acesso atual (0 = sem acesso ativo / esgotado)
function montar({ saldoRestante = 0, existeRadcheck = saldoRestante > 0 } = {}) {
  const db = criarDb(async (sql) => {
    if (/^SELECT \* FROM planos/.test(sql)) return [[PLANO]];
    if (/SELECT attribute, value FROM radcheck/.test(sql)) {
      return [existeRadcheck ? [
        { attribute: 'Cleartext-Password', value: 'senhaAnterior' },
        { attribute: 'Max-All-Session', value: '1800' },
      ] : []];
    }
    if (/COALESCE\(SUM/.test(sql)) return [[{ usado: 1800 - saldoRestante }]]; // max 1800s
    if (/FROM radacct/.test(sql)) return [[]]; // sem sessao ativa
    if (/FROM mikrotiks/.test(sql)) return [[{ end_hotspot: 'hotspot.local', ip: '10.0.0.1' }]];
    return undefined;
  });
  for (const f of ['src/utils/leadUtils.js', 'src/controllers/mikrotikAPIController.js']) delete require.cache[require.resolve(path.join(ROOT, f))];
  const mod = carregar('src/controllers/mikrotikAPIController.js', {
    db,
    extras: {
      'src/services/whatsappNotify.js': { notificarLiberacao: async () => {} },
      'src/utils/coa.js': { upgradeSessaoCoA: async () => ({ ok: true }) },
    },
  });
  return { db, mod };
}
const silencia = () => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; return () => { console.log = l; console.warn = w; }; };
const maxSession = (db) => Number(db.calls.find((c) => /INSERT INTO radcheck/.test(c.sql)).params[7]);
const timeout = (db) => db.calls.find((c) => /INSERT INTO radreply/.test(c.sql)).params.find((v, i, a) => a[i - 1] === 'Session-Timeout' || (i > 0 && String(a[i - 1]).startsWith('Session-Timeout')));
const libera = async (mod, extra = {}) => mod.liberarUsuario({ mac: 'AA:BB:CC:DD:EE:FF', ip: '10.1.1.1', plano: 'Plano 1h', empresa_id: 5, cpf: CPF, ...extra });

test('empilharTempo: soma o tempo restante ao do plano novo (Max-All-Session e Session-Timeout)', async () => {
  const { db, mod } = montar({ saldoRestante: 600 });
  const un = silencia(); let ret;
  try { ret = await libera(mod, { empilharTempo: true }); } finally { un(); }
  assert.strictEqual(maxSession(db), 3600 + 600);
  const rep = db.calls.find((c) => /INSERT INTO radreply/.test(c.sql));
  assert.ok(rep.params.includes('4200'), 'Session-Timeout = plano + restante');
  assert.strictEqual(ret.tempoAcumulado, 600);
});

test('empilharTempo: sem acesso ativo (ou esgotado) vale so o plano', async () => {
  for (const cenario of [{ saldoRestante: 0, existeRadcheck: false }, { saldoRestante: 0, existeRadcheck: true }]) {
    const { db, mod } = montar(cenario);
    const un = silencia(); let ret;
    try { ret = await libera(mod, { empilharTempo: true }); } finally { un(); }
    assert.strictEqual(maxSession(db), 3600);
    assert.strictEqual(ret.tempoAcumulado, 0);
    assert.ok(!db.calls.some((c) => /UPDATE pagamentos/.test(c.sql)), 'nada para estender');
  }
});

test('empilharTempo desligado (padrao, ex.: liberacao manual): nao soma nem consulta o saldo', async () => {
  const { db, mod } = montar({ saldoRestante: 600 });
  const un = silencia();
  try { await libera(mod); } finally { un(); }
  assert.strictEqual(maxSession(db), 3600);
  assert.ok(!db.calls.some((c) => /SELECT attribute, value FROM radcheck/.test(c.sql)), 'nao le o saldo');
  assert.ok(!db.calls.some((c) => /UPDATE pagamentos/.test(c.sql)));
});

test('empilhar: vencimento dos pagamentos aprovados do cliente acompanha o total (so avanca)', async () => {
  const { db, mod } = montar({ saldoRestante: 600 });
  const un = silencia();
  try { await libera(mod, { empilharTempo: true }); } finally { un(); }
  const upd = db.calls.find((c) => /UPDATE pagamentos/.test(c.sql));
  assert.ok(upd, 'estende expira_em');
  assert.match(upd.sql, /status = 'approved'/);
  assert.match(upd.sql, /empresa_id = \?/);
  assert.match(upd.sql, /expira_em IS NULL OR expira_em < /, 'nunca encurta');
  assert.deepStrictEqual(upd.params, [4200, 5, U, 4200]);
});

test('empilhar: sem CPF o vencimento e achado pelo MAC', async () => {
  const { db, mod } = montar({ saldoRestante: 600 });
  // sem CPF o username e' o MAC: o saldo e' consultado por ele
  const un = silencia();
  try { await libera(mod, { cpf: null, empilharTempo: true }); } finally { un(); }
  const upd = db.calls.find((c) => /UPDATE pagamentos/.test(c.sql));
  assert.ok(upd);
  assert.match(upd.sql, /AND mac = \?/);
  assert.strictEqual(upd.params[2], 'AA:BB:CC:DD:EE:FF');
});

test('empilhar: segue o mesmo padrao de sempre (Simultaneous-Use=1, liberado_em, sem Max-Daily-Session)', async () => {
  const { db, mod } = montar({ saldoRestante: 600 });
  const un = silencia();
  try { await libera(mod, { empilharTempo: true }); } finally { un(); }
  const todo = db.calls.map((c) => c.sql + JSON.stringify(c.params)).join('\n');
  assert.ok(!/Max-Daily-Session/.test(todo));
  assert.match(todo, /Simultaneous-Use/);
  assert.match(todo, /liberado_em = NOW\(\)/);
});

test('os 3 caminhos de pagamento (cartao, webhook PIX, polling PIX) empilham; a liberacao manual nao', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'src/controllers/pagamentoController.js'), 'utf8');
  for (const tipo of ['pagamento_cartao', 'pagamento_pix']) {
    const trechos = src.split(`contexto_tipo: "${tipo}"`).slice(1);
    assert.ok(trechos.length >= 1);
    for (const t of trechos) assert.match(t.slice(0, 200), /empilharTempo: true/);
  }
  const manual = src.split('contexto_tipo: "liberacao_manual"')[1].slice(0, 200);
  assert.doesNotMatch(manual, /empilharTempo: true/);
});
