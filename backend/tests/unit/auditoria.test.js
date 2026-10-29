// Auditoria do painel: classificacao das rotas, gravacao so em sucesso/autenticado e listagem escopada por empresa.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const montar = (handler) => {
  const db = criarDb(handler);
  const mod = carregar('src/utils/auditoria.js', { db });
  return { db, mod };
};

test('classificar: acoes sensiveis casam; leitura comum e rotas desconhecidas nao', () => {
  const { mod } = montar();
  assert.deepStrictEqual(mod.classificar('DELETE', '/api/leads/12'), { acao: 'cliente.excluir', entidade: 'cliente', id: '12' });
  assert.strictEqual(mod.classificar('DELETE', '/api/leads/massa').acao, 'cliente.excluir_massa');
  assert.strictEqual(mod.classificar('GET', '/api/leads/export').acao, 'cliente.exportar');
  assert.strictEqual(mod.classificar('PUT', '/api/planos/3').acao, 'plano.editar');
  assert.strictEqual(mod.classificar('POST', '/api/admins').acao, 'usuario.criar');
  assert.strictEqual(mod.classificar('PUT', '/api/empresa-config/mercadopago').id, 'mercadopago');
  assert.strictEqual(mod.classificar('POST', '/api/vouchers/massa-filtro').acao, 'voucher.massa');
  assert.strictEqual(mod.classificar('GET', '/api/leads'), null);
  assert.strictEqual(mod.classificar('GET', '/api/planos'), null);
  assert.strictEqual(mod.classificar('DELETE', '/api/leads/abc'), null);
  assert.strictEqual(mod.classificar('POST', '/api/leads/export'), null);
});

const rodar = (mod, { metodo, url, status, user = { id: 3 }, body = {} }) => {
  const res = new EventEmitter();
  res.statusCode = status;
  const req = { method: metodo, originalUrl: url, empresa_id: 7, user, body, ip: '::ffff:10.0.0.5' };
  let seguiu = false;
  mod.auditoriaMiddleware(req, res, () => { seguiu = true; });
  res.emit('finish');
  return seguiu;
};

test('middleware: grava so em sucesso autenticado; guarda so contagem (nunca o corpo) e o IP limpo', async () => {
  const { mod, db } = montar();
  assert.strictEqual(rodar(mod, { metodo: 'DELETE', url: '/api/leads/massa?x=1', status: 200, body: { ids: [1, 2, 3], senha: 'segredo' } }), true);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(db.calls.length, 1);
  const c = db.calls[0];
  assert.match(c.sql, /INSERT INTO audit_logs/);
  assert.deepStrictEqual(c.params.slice(0, 3), [7, 3, 'cliente.excluir_massa']);
  assert.strictEqual(c.params[5], '3 registro(s)');
  assert.strictEqual(c.params[6], '10.0.0.5');
  assert.ok(!JSON.stringify(c.params).includes('segredo'));

  for (const caso of [
    { metodo: 'DELETE', url: '/api/leads/5', status: 403 },
    { metodo: 'DELETE', url: '/api/leads/5', status: 500 },
    { metodo: 'DELETE', url: '/api/leads/5', status: 200, user: null },
    { metodo: 'GET', url: '/api/leads', status: 200 },
  ]) {
    rodar(mod, caso);
    await new Promise((r) => setImmediate(r));
  }
  assert.strictEqual(db.calls.length, 1); // nenhuma das outras gravou
});

test('registrar: tabela ausente e erro de banco nunca lancam', async () => {
  const w = console.warn; console.warn = () => {};
  try {
    const { mod } = montar(() => { throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); });
    await mod.registrar({ empresa_id: 7, user: { id: 1 }, ip: '1.1.1.1' }, 'a.b', 'e', '1');
    const { mod: mod2 } = montar(() => { throw new Error('boom'); });
    await mod2.registrar({ empresa_id: 7, user: { id: 1 }, ip: '1.1.1.1' }, 'a.b', 'e', '1');
  } finally { console.warn = w; }
});

test('listar: escopado por empresa, filtros parametrizados e 503 com instrucao sem a tabela', async () => {
  const db = criarDb((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return [[{ n: 1 }]];
    if (/FROM audit_logs l LEFT JOIN admins/.test(sql) && /LIMIT/.test(sql)) return [[{ id: 1, acao: 'plano.excluir', usuario: 'Ana' }]];
    if (/DISTINCT acao/.test(sql)) return [[{ acao: 'plano.excluir' }]];
  });
  const c = carregar('src/controllers/auditoriaController.js', { db });
  const res = criarRes();
  await c.listar(criarReq({ empresa_id: 7, query: { de: '2026-10-01', ate: '2026-10-31', acao: 'plano.excluir', q: "x'; DROP--%" } }), res);
  assert.strictEqual(res.body.total, 1);
  assert.deepStrictEqual(res.body.acoes, ['plano.excluir']);
  const q = db.calls.find((x) => /LIMIT/.test(x.sql) && /ORDER BY/.test(x.sql));
  assert.match(q.sql, /l\.empresa_id = \?/);
  assert.strictEqual(q.params[0], 7);
  assert.doesNotMatch(q.sql, /DROP/); // texto do filtro vai por parametro
  assert.ok(q.params.some((p) => String(p).includes('DROP')));

  const sem = carregar('src/controllers/auditoriaController.js', { db: criarDb(() => { throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); }) });
  const r2 = criarRes();
  await sem.listar(criarReq({ empresa_id: 7, query: {} }), r2);
  assert.strictEqual(r2.statusCode, 503);
  assert.match(r2.body.error, /migration 055/);
});
