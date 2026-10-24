// Isolamento multi-tenant: toda query tocando tabela com empresa_id deve receber
// o empresa_id da req (assert nos params), com db mockado.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const EMP = 777;
const TABELAS_TENANT = ['planos', 'leads', 'radius_users', 'connection_logs', 'pagamentos', 'mikrotiks', 'access_points', 'cl'];
const TABELAS_USERNAME = /\b(radcheck|radreply|radusergroup|radpostauth)\b/;

// Respostas "felizes" para os caminhos que consultam antes de agir.
function handlerPadrao(sql) {
  if (/COUNT\(\*\) as (\w+)/i.test(sql)) return [[{ total_pagamentos: 0, pagamentos_24h: 0, total_usuarios: 0, total_mikrotiks: 0, total: 0 }]];
  if (/^SELECT .*FROM radius_users WHERE username/i.test(sql)) return [[{ id: 1 }]];
  if (/^SELECT .*FROM planos WHERE id/i.test(sql)) return [[{ id: 1, nome: 'p', velocidade_down: 2, velocidade_up: 1, duracao_minutos: 60, mikrotik_id: 3 }]];
  if (/^(UPDATE|DELETE)/i.test(sql)) return [{ affectedRows: 1 }];
  return undefined;
}

function tocaTenant(sql) {
  return TABELAS_TENANT.some((t) => new RegExp(`\\b(FROM|JOIN|UPDATE)\\s+${t}\\b`, 'i').test(sql));
}
function assertTodasFiltradas(db, rotulo) {
  const consultas = db.calls.filter((c) => !/^INSERT/i.test(c.sql) && tocaTenant(c.sql));
  assert.ok(consultas.length > 0, `${rotulo}: nenhuma query de tabela tenant executada`);
  for (const c of consultas) {
    assert.match(c.sql, /empresa_id/i, `${rotulo}: sem empresa_id no SQL -> ${c.sql}`);
    assert.ok(c.params.includes(EMP), `${rotulo}: params sem empresa_id da req -> ${c.sql} ${JSON.stringify(c.params)}`);
  }
}
async function exec(modPath, fn, reqOver, handler = handlerPadrao, extras) {
  const db = criarDb(handler);
  const mod = carregar(modPath, { db, extras });
  const res = criarRes();
  const orig = console.error; console.error = () => {};
  try { await mod[fn](criarReq({ empresa_id: EMP, ...reqOver }), res); } finally { console.error = orig; }
  return { db, res };
}

// ---- planos ----
const PLANO_BODY = { nome: 'n', descricao: 'd', valor: 1, duracao_minutos: 60, velocidade_down: 2, velocidade_up: 1, mikrotik_id: 3, address_pool: 'x', shared_users: 1, ativo: 1 };
test('planos: listar filtra por empresa_id da req', async () => {
  const { db } = await exec('src/controllers/planController.js', 'listarPlanos', {});
  assertTodasFiltradas(db, 'listarPlanos');
});
test('planos: atualizar usa empresa_id da req (e nao o do body)', async () => {
  const { db } = await exec('src/controllers/planController.js', 'atualizarPlano', { params: { id: '5' }, body: { ...PLANO_BODY, empresa_id: 4242 } });
  assertTodasFiltradas(db, 'atualizarPlano');
  assert.ok(!db.calls[0].params.includes(4242));
});
test('planos: deletar (select + delete) filtra por empresa_id', async () => {
  const { db } = await exec('src/controllers/planController.js', 'deletarPlano', { params: { id: '5' } }, async (s) => (/^SELECT/.test(s) ? [[{ id: 5 }]] : [{}]));
  assertTodasFiltradas(db, 'deletarPlano'); assert.strictEqual(db.calls.length, 2);
});
test('planos: deletar plano de outra empresa -> 404 e nenhum DELETE', async () => {
  const { db, res } = await exec('src/controllers/planController.js', 'deletarPlano', { params: { id: '5' } }, async () => [[]]);
  assert.strictEqual(res.statusCode, 404); assert.ok(!db.calls.some((c) => /^DELETE/.test(c.sql)));
});
test('planos: criar grava empresa_id da req, ignorando body.empresa_id', async () => {
  const { db } = await exec('src/controllers/planController.js', 'criarPlano', { body: { ...PLANO_BODY, empresa_id: 4242 } });
  assert.strictEqual(db.calls[0].params[0], EMP); assert.ok(!db.calls[0].params.includes(4242));
});

// ---- leads ----
test('leads: listar (com filtros) filtra por empresa_id', async () => {
  const { db } = await exec('src/controllers/leadController.js', 'listarLeads', { query: { status: 'novo', q: 'ana' } });
  assertTodasFiltradas(db, 'listarLeads');
  assert.strictEqual(db.calls[0].params[0], EMP);
});
test('leads: atualizar / deletar / exportar filtram por empresa_id', async () => {
  let r = await exec('src/controllers/leadController.js', 'atualizarLead', { params: { id: '9' }, body: { nome: 'x' } });
  assertTodasFiltradas(r.db, 'atualizarLead'); assert.deepStrictEqual(r.db.calls[0].params.slice(-2), ['9', EMP]);
  r = await exec('src/controllers/leadController.js', 'deletarLead', { params: { id: '9' } });
  assertTodasFiltradas(r.db, 'deletarLead');
  r = await exec('src/controllers/leadController.js', 'exportarLeadsCSV', {});
  assertTodasFiltradas(r.db, 'exportarLeadsCSV');
});
test('leads: criar grava empresa_id da req', async () => {
  const { db } = await exec('src/controllers/leadController.js', 'criarLead', { body: { nome: 'a', empresa_id: 1 } }, async () => [{ insertId: 1 }]);
  assert.strictEqual(db.calls[0].params[0], EMP);
});
test('leads: atualizar lead de outra empresa (affectedRows=0) -> 404', async () => {
  const { res } = await exec('src/controllers/leadController.js', 'atualizarLead', { params: { id: '9' }, body: { nome: 'x' } }, async () => [{ affectedRows: 0 }]);
  assert.strictEqual(res.statusCode, 404);
});

// ---- radiusController ----
test('radius: listarUsuarios e listarSessoesAtivas filtram por empresa_id', async () => {
  for (const fn of ['listarUsuarios', 'listarSessoesAtivas']) {
    const { db } = await exec('src/controllers/radiusController.js', fn, {});
    assert.ok(db.calls.every((c) => c.params.includes(EMP)), fn);
    assert.match(db.calls[0].sql, /empresa_id/);
  }
});
test('radius: deletarUsuarioRadius checa posse (empresa_id) antes e filtra o DELETE de radius_users', async () => {
  const { db, res } = await exec('src/controllers/radiusController.js', 'deletarUsuarioRadius', { params: { username: 'joao' } });
  assert.strictEqual(res.statusCode, 200);
  assert.match(db.calls[0].sql, /^SELECT .*radius_users.*empresa_id/);
  assert.deepStrictEqual(db.calls[0].params, ['joao', EMP]);
  const del = db.calls.find((c) => /^DELETE FROM radius_users/.test(c.sql));
  assert.deepStrictEqual(del.params, ['joao', EMP]);
});
test('radius: deletar usuario de OUTRA empresa -> 404 e nenhum DELETE em tabelas RADIUS', async () => {
  const { db, res } = await exec('src/controllers/radiusController.js', 'deletarUsuarioRadius', { params: { username: 'joao' } }, async () => [[]]);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(db.calls.filter((c) => /^DELETE/.test(c.sql)).length, 0);
});
test('radius: vincularPlano de usuario/plano de outra empresa -> 404 sem alterar RADIUS', async () => {
  let r = await exec('src/controllers/radiusController.js', 'vincularPlano', { body: { username: 'joao', planoId: 1 } }, async () => [[]]);
  assert.strictEqual(r.res.statusCode, 404); assert.strictEqual(r.db.calls.length, 1);
  assert.deepStrictEqual(r.db.calls[0].params, ['joao', EMP]);
  // usuario e' da empresa, plano nao
  r = await exec('src/controllers/radiusController.js', 'vincularPlano', { body: { username: 'joao', planoId: 1 } }, async (s) => (/radius_users/.test(s) ? [[{ id: 1 }]] : [[]]));
  assert.strictEqual(r.res.statusCode, 404);
  assert.ok(!r.db.calls.some((c) => /^(DELETE|INSERT|UPDATE)/.test(c.sql)));
  assert.deepStrictEqual(r.db.calls[1].params, [1, EMP]);
});
test('radius: vincularPlano - UPDATE de radius_users filtra por empresa_id', async () => {
  const { db } = await exec('src/controllers/radiusController.js', 'vincularPlano', { body: { username: 'joao', planoId: 1 } });
  const up = db.calls.filter((c) => /^UPDATE radius_users/.test(c.sql));
  assert.ok(up.length >= 1);
  // O UPDATE do vinculo precisa de empresa_id
  assert.ok(up.some((c) => c.params.includes(EMP)));
});
test('radius: criarUsuarioRadius rejeita username de outra empresa', async () => {
  const { db, res } = await exec('src/controllers/radiusController.js', 'criarUsuarioRadius', { body: { username: 'joao', password: 'x' } }, async (s) => (/SELECT ru.empresa_id/.test(s) ? [[{ empresa_id: 1 }]] : undefined));
  assert.strictEqual(res.statusCode, 400); assert.strictEqual(db.calls.length, 1);
});
test('radius: criarUsuarioRadius grava empresa_id da req em radius_users', async () => {
  const { db } = await exec('src/controllers/radiusController.js', 'criarUsuarioRadius', { body: { username: 'joao', password: 'x' } });
  const ins = db.calls.find((c) => /INSERT INTO radius_users/.test(c.sql));
  assert.strictEqual(ins.params[0], EMP);
});
test('radius: DELETEs em tabelas RADIUS (por username) so ocorrem apos checagem de posse', async () => {
  const { db } = await exec('src/controllers/radiusController.js', 'deletarUsuarioRadius', { params: { username: 'joao' } });
  const idxPosse = db.calls.findIndex((c) => /radius_users/.test(c.sql) && c.params.includes(EMP));
  const idxDel = db.calls.findIndex((c) => /^DELETE/.test(c.sql) && TABELAS_USERNAME.test(c.sql));
  assert.ok(idxPosse === 0 && idxDel > idxPosse);
});

// ---- compliance ----
test('compliance: buscarLogs/exportarCSV filtram por empresa_id (inclusive nos JOINs)', async () => {
  for (const fn of ['buscarLogs', 'exportarCSV']) {
    const { db } = await exec('src/controllers/complianceController.js', fn, { query: { cpf: '1', mac: 'aa', page: '2' } }, async (s) => (/COUNT/i.test(s) ? [[{ total: 0 }]] : undefined));
    const principais = db.calls.filter((c) => /connection_logs/.test(c.sql));
    assert.ok(principais.length > 0, fn);
    for (const c of principais) {
      assert.match(c.sql, /cl\.empresa_id = \?/, fn);
      assert.strictEqual(c.params[0], EMP, fn);
      if (/JOIN mikrotiks/.test(c.sql)) assert.match(c.sql, /m\.empresa_id = cl\.empresa_id/, 'JOIN mikrotiks sem empresa_id');
    }
  }
});
test('compliance: query com empresa_id de outra empresa na query string nao sobrescreve', async () => {
  const { db } = await exec('src/controllers/complianceController.js', 'buscarLogs', { query: { empresa_id: '1' } }, async (s) => (/COUNT/i.test(s) ? [[{ total: 0 }]] : undefined));
  assert.strictEqual(db.calls[0].params[0], EMP); assert.ok(!db.calls[0].params.includes('1'));
});
test('compliance: access points listar/renomear filtram por empresa_id', async () => {
  let r = await exec('src/controllers/complianceController.js', 'listarAccessPoints', {});
  assertTodasFiltradas(r.db, 'listarAccessPoints');
  r = await exec('src/controllers/complianceController.js', 'renomearAccessPoint', { params: { id: '3' }, body: { nome: 'AP' } });
  assertTodasFiltradas(r.db, 'renomearAccessPoint');
});

// ---- dashboard ----
test('dashboard: todas as queries filtram por empresa_id', async () => {
  const { db, res } = await exec('src/controllers/dashboardController.js', 'getDashboard', {});
  assert.strictEqual(res.statusCode, 200);
  assert.ok(db.calls.length >= 4);
  assertTodasFiltradas(db, 'getDashboard');
  for (const c of db.calls) assert.deepStrictEqual(c.params, [EMP]);
});
