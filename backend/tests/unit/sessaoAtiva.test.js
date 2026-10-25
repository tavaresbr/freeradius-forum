const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ---- banco simulado ----
const chamadas = [];
const estado = { senha: 'abc23456', usernameGravado: '52998224725', donoEmpresa: 7, sessao: null, mikrotik: null, aberta: true, empresaMtk: 7, cpfConfirmado: true, planoDoAcesso: null, aparelhoJaUsou: false, pagouAgora: false };
const fakeDb = {
  query: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM radacct ra/.test(sql)) return [[estado.sessao].filter(Boolean)];
    if (/SELECT acctstoptime FROM radacct/.test(sql)) return [[{ acctstoptime: estado.aberta ? null : new Date() }]];
    if (/FROM mikrotiks WHERE ip/.test(sql)) return [[estado.mikrotik].filter(Boolean)];
    if (/FROM radius_users WHERE username/.test(sql)) return [estado.donoEmpresa ? [{ empresa_id: estado.donoEmpresa }] : []];
    if (/FROM pagamentos/.test(sql)) return [estado.pagouAgora ? [{ 1: 1 }] : []];            // pagamento recente deste aparelho
    return [{ affectedRows: 1 }];
  },
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ empresa_id: estado.empresaMtk }].filter(() => estado.empresaMtk)];
    if (/FROM radcheck WHERE username/.test(sql)) return [params[0] === estado.usernameGravado ? [{ value: estado.senha }] : []];
    if (/FROM radius_users WHERE username/.test(sql)) return [estado.donoEmpresa ? [{ empresa_id: estado.donoEmpresa }] : []];
    if (/FROM pagamentos/.test(sql)) return [estado.cpfConfirmado ? [{ 1: 1 }] : []];          // CPF confirmado por pagamento
    if (/FROM radius_users ru JOIN planos/.test(sql)) return [[estado.planoDoAcesso ? { nome: estado.planoDoAcesso } : undefined].filter(Boolean)];
    if (/FROM radacct\s+WHERE username = \? AND LOWER/.test(sql)) return [estado.aparelhoJaUsou ? [{ 1: 1 }] : []];
    return [[]];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

// ---- node-routeros simulado (fallback pela API do MikroTik) ----
const api = { ativos: [], falhaConexao: false, removidos: [] };
const rosPath = require.resolve('node-routeros');
require.cache[rosPath] = { id: rosPath, filename: rosPath, loaded: true, exports: {
  RouterOSAPI: class {
    async connect() { if (api.falhaConexao) throw new Error('timeout'); }
    async write(cmd, args) {
      if (cmd.endsWith('/print')) return api.ativos;
      api.removidos.push({ cmd, args });
      return [];
    }
    async close() {}
  },
} };

const coa = require('../../src/utils/coa');
const sessaoAtiva = require('../../src/utils/sessaoAtiva');
const leadUtils = require('../../src/utils/leadUtils');
let confResp = 'ok';
leadUtils.conferirDataNascimento = async () => confResp;
let leadResp = null;
leadUtils.verificarLeadExistente = async () => leadResp;
const { desconectarAnterior } = require('../../src/controllers/sessaoController');

sessaoAtiva._cfg.esperaMs = 30; sessaoAtiva._cfg.passoMs = 10;

const CPF = '529.982.247-25';
// qualquer escrita nas tabelas de credencial/saldo (a desconexao nunca pode tocar nelas)
const ESCRITA_RADIUS = /^\s*(DELETE|INSERT)|UPDATE\s+(radcheck|radreply|radusergroup|radius_users)|DELETE\s+FROM/i;
const sessaoOutroAparelho = { radacctid: 11, acctsessionid: 'abc', nasipaddress: '10.0.0.1', callingstationid: '76-DC-82-A1-64-F4', framedipaddress: '10.5.50.9', acctstarttime: new Date('2026-10-24T14:07:00Z') };
const reset = () => {
  chamadas.length = 0; estado.sessao = { ...sessaoOutroAparelho }; estado.mikrotik = { ip: '10.0.0.1', usuario: 'u', senha: 's', porta: 8728 };
  estado.aberta = true; estado.empresaMtk = 7; api.ativos = []; api.falhaConexao = false; api.removidos = []; confResp = 'ok'; leadResp = null;
  estado.cpfConfirmado = true; estado.planoDoAcesso = null; estado.aparelhoJaUsou = false; estado.pagouAgora = false; estado.senha = 'abc23456'; estado.usernameGravado = '52998224725'; estado.donoEmpresa = 7;
  require('../../src/utils/loginTentativas')._resetar();
  coa.desconectarSessaoCoA = async () => ({ ok: true });
};
const resFalso = () => { const r = { statusCode: 200, corpo: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.corpo = o; return r; }; return r; };
const fechaNoStop = () => { setTimeout(() => { estado.aberta = false; }, 5); };

test('buscarSessaoAtiva exige username e empresa e filtra orfas/empresa no SQL', async () => {
  reset();
  assert.strictEqual(await sessaoAtiva.buscarSessaoAtiva('', 7), null);
  assert.strictEqual(await sessaoAtiva.buscarSessaoAtiva('x', null), null);
  assert.strictEqual(chamadas.length, 0);
  const s = await sessaoAtiva.buscarSessaoAtiva('52998224725', 7);
  assert.strictEqual(s.radacctid, 11);
  assert.match(chamadas[0].sql, /acctstoptime IS NULL/);
  assert.match(chamadas[0].sql, /INTERVAL 15 MINUTE/);
  assert.match(chamadas[0].sql, /COALESCE\(m\.empresa_id, ru\.empresa_id\) = \?/);
  assert.deepStrictEqual(chamadas[0].params, ['52998224725', 7]);
});

test('tratarSessaoAtiva: sem sessao -> {}; outro aparelho -> pede decisao e mascara o MAC', async () => {
  reset();
  estado.sessao = null;
  assert.deepStrictEqual(await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7 }), {});
  reset();
  const r = await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7 });
  assert.strictEqual(r.requer_desconexao, true);
  assert.strictEqual(r.sessao_ativa.aparelho, '…64:F4');
  assert.ok(!JSON.stringify(r).includes('76-DC') && !JSON.stringify(r).includes('10.5.50.9'));
  assert.ok(!chamadas.some((c) => /UPDATE radacct|DELETE/.test(c.sql)));   // nada foi derrubado sem confirmacao
});

test('tratarSessaoAtiva: mesmo aparelho -> derruba a sessao velha sozinho e segue', async () => {
  reset();
  let pedido = null;
  coa.desconectarSessaoCoA = async (p) => { pedido = p; fechaNoStop(); return { ok: true }; };
  const r = await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: '76:dc:82:a1:64:f4', empresaId: 7 });
  assert.deepStrictEqual(r, {});
  assert.strictEqual(pedido.username, 'u');
  assert.strictEqual(pedido.sessao.acctsessionid, 'abc');
});

test('desconectarSessao: stop nao chega a tempo -> fecha a linha; credenciais intactas', async () => {
  reset();
  const r = await sessaoAtiva.desconectarSessao({ sessao: estado.sessao, username: 'u', empresaId: 7 });
  assert.deepStrictEqual([r.ok, r.metodo], [true, 'disconnect']);
  const upd = chamadas.find((c) => /UPDATE radacct/.test(c.sql));
  assert.match(upd.sql, /Admin-Reset/);
  assert.deepStrictEqual(upd.params, [11]);
  assert.ok(!chamadas.some((c) => ESCRITA_RADIUS.test(c.sql)));
});

test('desconectarSessao: Disconnect falha -> usa a API do MikroTik (so remove a conexao ativa)', async () => {
  reset();
  coa.desconectarSessaoCoA = async () => ({ ok: false, error: 'radclient ausente' });
  api.ativos = [{ '.id': '*5', user: 'u' }];
  fechaNoStop();
  const r = await sessaoAtiva.desconectarSessao({ sessao: estado.sessao, username: 'u', empresaId: 7 });
  assert.deepStrictEqual([r.ok, r.metodo], [true, 'mikrotik-api']);
  assert.deepStrictEqual(api.removidos, [{ cmd: '/ip/hotspot/active/remove', args: ['=.id=*5'] }]);
  const busca = chamadas.find((c) => /FROM mikrotiks WHERE ip/.test(c.sql));
  assert.deepStrictEqual(busca.params, ['10.0.0.1', 7]);   // mikrotik da MESMA empresa
});

test('desconectarSessao: nenhum metodo funciona -> ok:false e a linha NAO e fechada', async () => {
  reset();
  coa.desconectarSessaoCoA = async () => ({ ok: false });
  estado.mikrotik = null;
  const r = await sessaoAtiva.desconectarSessao({ sessao: estado.sessao, username: 'u', empresaId: 7 });
  assert.strictEqual(r.ok, false);
  assert.ok(!chamadas.some((c) => /UPDATE radacct/.test(c.sql)));
  reset();
  coa.desconectarSessaoCoA = async () => ({ ok: false });
  api.falhaConexao = true;
  assert.strictEqual((await sessaoAtiva.desconectarSessao({ sessao: estado.sessao, username: 'u', empresaId: 7 })).ok, false);
});

test('tratarSessaoAtiva nunca bloqueia o login por erro interno', async () => {
  reset();
  const orig = fakeDb.query;
  fakeDb.query = async () => { throw new Error('db fora'); };
  const w = console.warn; console.warn = () => {};
  try { assert.deepStrictEqual(await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: 'x', empresaId: 7 }), {}); } finally { console.warn = w; fakeDb.query = orig; }
});

test('endpoint: exige CPF, data e usuario validos e equipamento conhecido', async () => {
  reset();
  for (const body of [{}, { cpf: '123', data_nascimento: '17/05/1990', username: 'u', mikrotik_id: 3 }, { cpf: CPF, data_nascimento: '2999-01-01', username: 'u', mikrotik_id: 3 }, { cpf: CPF, data_nascimento: '17/05/1990', mikrotik_id: 3 }]) {
    const r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
    assert.strictEqual(r.statusCode, 400);
  }
  estado.empresaMtk = null;
  const r = resFalso(); await desconectarAnterior({ body: { cpf: CPF, data_nascimento: '17/05/1990', username: '52998224725', mikrotik_id: 3 }, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 400);
});

test('endpoint: so com data de nascimento "ok" (divergente, ausente, reivindicado -> 403; bloqueado -> 429)', async () => {
  const body = { cpf: CPF, data_nascimento: '17/05/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 };
  for (const conf of ['divergente', 'ausente', 'reivindicado']) {
    reset(); confResp = conf;
    const r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
    assert.strictEqual(r.statusCode, 403, conf);
    assert.strictEqual(r.corpo.requer_data_nascimento, true);
    assert.ok(!chamadas.some((c) => /UPDATE radacct/.test(c.sql)));
  }
  reset(); confResp = 'bloqueado';
  const r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 429);
});

test('endpoint: username de OUTRA pessoa -> 403; do proprio titular (CPF ou telefone do lead) -> desconecta', async () => {
  const base = { cpf: CPF, data_nascimento: '17/05/1990', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 };
  reset(); leadResp = { id: 1, telefone: '(93) 99999-0000', email: 'a@b.com', mac: 'AA:BB:CC:DD:EE:FF', cpf: '52998224725' };
  let r = resFalso(); await desconectarAnterior({ body: { ...base, username: '93888887777' }, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 403);
  assert.ok(!chamadas.some((c) => /FROM radacct ra/.test(c.sql)));   // nem consulta a sessao de outro usuario

  reset(); leadResp = { id: 1, telefone: '(93) 99999-0000', email: 'a@b.com', mac: 'AA:BB:CC:DD:EE:FF', cpf: '52998224725' };
  fechaNoStop();
  r = resFalso(); await desconectarAnterior({ body: { ...base, username: '52998224725' }, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.corpo, { success: true, desconectado: true });
  assert.ok(!chamadas.some((c) => ESCRITA_RADIUS.test(c.sql)));
  const busca = chamadas.find((c) => /FROM radacct ra/.test(c.sql));
  assert.deepStrictEqual(busca.params, ['52998224725', 7]);   // empresa do equipamento, nao do cliente

  reset(); leadResp = { id: 1, telefone: '(93) 99999-0000', email: 'a@b.com', mac: 'AA:BB:CC:DD:EE:FF', cpf: '52998224725' };
  fechaNoStop();
  r = resFalso(); await desconectarAnterior({ body: { ...base, username: '93999990000' }, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 200);
});

test('endpoint: sem sessao ativa -> sucesso sem desconectar; falha do equipamento -> 502', async () => {
  const body = { cpf: CPF, data_nascimento: '17/05/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 };
  reset(); estado.sessao = null;
  let r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
  assert.deepStrictEqual(r.corpo, { success: true, desconectado: false });
  reset(); coa.desconectarSessaoCoA = async () => ({ ok: false }); estado.mikrotik = null;
  r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 502);
});

test('endpoint: CPF sem pagamento + acesso que NAO e o plano gratis + aparelho que nunca o usou -> 403 sem derrubar nada', async () => {
  const body = { cpf: CPF, data_nascimento: '17/05/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 };
  reset(); estado.cpfConfirmado = false; estado.planoDoAcesso = 'Plano 30 dias (admin)';
  leadResp = { id: 1, telefone: '(93) 99999-0000', email: 'a@b.com', mac: 'AA:BB:CC:DD:EE:FF', cpf: '52998224725' };
  const r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
  assert.strictEqual(r.statusCode, 403);
  assert.ok(!chamadas.some((c) => /FROM radacct ra/.test(c.sql) || /UPDATE radacct/.test(c.sql)));
});

test('endpoint: CPF sem pagamento mas aparelho que ja usou o acesso, ou acesso gratis (LGPD/Lead) -> desconecta', async () => {
  const body = { cpf: CPF, data_nascimento: '17/05/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 };
  for (const cenario of [{ aparelhoJaUsou: true, planoDoAcesso: 'Plano 30 dias (admin)' }, { planoDoAcesso: 'LGPD' }, { planoDoAcesso: 'Lead' }]) {
    reset(); estado.cpfConfirmado = false; Object.assign(estado, cenario);
    leadResp = { id: 1, telefone: '(93) 99999-0000', email: 'a@b.com', mac: 'AA:BB:CC:DD:EE:FF', cpf: '52998224725' };
    fechaNoStop();
    const r = resFalso(); await desconectarAnterior({ body, ip: '1.1.1.1' }, r);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(cenario));
  }
});

test('tratarSessaoAtiva: manterMesmoAparelho (pagamento) nao derruba a sessao do proprio aparelho', async () => {
  reset();
  let chamouDisconnect = false;
  coa.desconectarSessaoCoA = async () => { chamouDisconnect = true; return { ok: true }; };
  const r = await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: '76:dc:82:a1:64:f4', empresaId: 7, manterMesmoAparelho: true });
  assert.deepStrictEqual(r, {});
  assert.strictEqual(chamouDisconnect, false);
  // outro aparelho continua pedindo decisao
  const r2 = await sessaoAtiva.tratarSessaoAtiva({ username: 'u', mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7, manterMesmoAparelho: true });
  assert.strictEqual(r2.requer_desconexao, true);
});

test('pagamentoRecenteDoAparelho: exige CPF e MAC validos e filtra empresa/CPF/MAC/janela no SQL', async () => {
  reset();
  assert.strictEqual(await sessaoAtiva.pagamentoRecenteDoAparelho({ cpf: '123', mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7 }), false);
  assert.strictEqual(await sessaoAtiva.pagamentoRecenteDoAparelho({ cpf: CPF, mac: '', empresaId: 7 }), false);
  assert.strictEqual(chamadas.length, 0);
  assert.strictEqual(await sessaoAtiva.pagamentoRecenteDoAparelho({ cpf: CPF, mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7 }), false);
  const q = chamadas.find((c) => /FROM pagamentos/.test(c.sql));
  assert.match(q.sql, /status = 'approved'/);
  assert.match(q.sql, /liberado_em > NOW\(\) - INTERVAL 30 MINUTE/);
  assert.deepStrictEqual(q.params, [7, '52998224725', 'aabbccddeeff']);
  estado.pagouAgora = true;
  assert.strictEqual(await sessaoAtiva.pagamentoRecenteDoAparelho({ cpf: CPF, mac: 'AA:BB:CC:DD:EE:FF', empresaId: 7 }), true);
});

test('desconectarAnterior: quem acabou de pagar neste aparelho pode derrubar a sessao anterior (acesso pago, CPF nao confirmado)', async () => {
  reset();
  estado.cpfConfirmado = false; estado.aparelhoJaUsou = false; estado.planoDoAcesso = 'Plano Pago'; estado.pagouAgora = true;
  coa.desconectarSessaoCoA = async () => { fechaNoStop(); return { ok: true }; };
  const res = resFalso();
  await desconectarAnterior({ body: { cpf: CPF, data_nascimento: '01/02/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 }, ip: '1.1.1.1' }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.corpo.desconectado, true);
  assert.ok(!chamadas.some((c) => ESCRITA_RADIUS.test(c.sql)));
});

test('desconectarAnterior: sem pagamento recente, sem uso previo e acesso pago => 403', async () => {
  reset();
  estado.cpfConfirmado = false; estado.aparelhoJaUsou = false; estado.planoDoAcesso = 'Plano Pago'; estado.pagouAgora = false;
  const res = resFalso();
  await desconectarAnterior({ body: { cpf: CPF, data_nascimento: '01/02/1990', username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3 }, ip: '1.1.1.1' }, res);
  assert.strictEqual(res.statusCode, 403);
});

// ---- modo usuario + senha (tela LoginHotspot) ----
const corpoSenha = (extra = {}) => ({ body: { username: '529.982.247-25', password: 'abc23456', mac: 'AA:BB:CC:DD:EE:FF', mikrotik_id: 3, ...extra }, ip: '1.1.1.1' });

test('desconectarAnterior por senha: senha certa derruba a sessao anterior (sem CPF/data e sem tocar em credenciais)', async () => {
  reset();
  coa.desconectarSessaoCoA = async () => { fechaNoStop(); return { ok: true }; };
  const res = resFalso();
  await desconectarAnterior(corpoSenha(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.corpo.desconectado, true);
  assert.ok(!chamadas.some((c) => ESCRITA_RADIUS.test(c.sql)));
});

test('desconectarAnterior por senha: senha errada => 401 generico; usuario inexistente => mesma resposta; nada derrubado', async () => {
  reset();
  let chamou = false;
  coa.desconectarSessaoCoA = async () => { chamou = true; return { ok: true }; };
  const a = resFalso(); await desconectarAnterior(corpoSenha({ password: 'errada' }), a);
  const b = resFalso(); await desconectarAnterior(corpoSenha({ username: '11122233396' }), b);
  assert.strictEqual(a.statusCode, 401);
  assert.strictEqual(b.statusCode, 401);
  assert.deepStrictEqual(a.corpo, b.corpo);
  assert.strictEqual(chamou, false);
});

test('desconectarAnterior por senha: 10 erros do mesmo IP => 429', async () => {
  reset();
  let ultimo;
  for (let i = 0; i < 11; i++) { ultimo = resFalso(); await desconectarAnterior(corpoSenha({ password: `err${i}` }), ultimo); }
  assert.strictEqual(ultimo.statusCode, 429);
});

test('desconectarAnterior por senha: senha legada (== username) so em aparelho que ja usou o acesso', async () => {
  reset();
  estado.senha = '52998224725'; estado.aparelhoJaUsou = false;
  const a = resFalso(); await desconectarAnterior(corpoSenha({ password: '52998224725' }), a);
  assert.strictEqual(a.statusCode, 401);
  estado.aparelhoJaUsou = true;
  coa.desconectarSessaoCoA = async () => { fechaNoStop(); return { ok: true }; };
  const b = resFalso(); await desconectarAnterior(corpoSenha({ password: '52998224725' }), b);
  assert.strictEqual(b.statusCode, 200);
});

test('desconectarAnterior por senha: acesso de OUTRA empresa => 401 (multi-tenant)', async () => {
  reset();
  estado.donoEmpresa = 99;
  const res = resFalso(); await desconectarAnterior(corpoSenha(), res);
  assert.strictEqual(res.statusCode, 401);
});

test('desconectarAnterior por senha: equipamento invalido => 400', async () => {
  reset();
  estado.empresaMtk = null;
  const res = resFalso(); await desconectarAnterior(corpoSenha(), res);
  assert.strictEqual(res.statusCode, 400);
});
