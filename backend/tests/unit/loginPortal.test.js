// Login por usuario/senha do portal (reconexao): enumeracao, forca bruta, senha legada e tenant.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => {
  for (const f of ['src/utils/leadUtils.js', 'src/utils/loginTentativas.js', 'src/utils/dobTentativas.js']) delete require.cache[require.resolve(path.join(ROOT, f))];
  require('../../src/utils/loginTentativas')._resetar();
};
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

function ctrl({ senha = 'abc23456', usernameGravado = '52998224725', aparelhoConhecido = false, donoEmpresa = 5, mkEmpresa = 5, sessaoResp = null } = {}) {
  limpar();
  const db = criarDb(async (sql, p) => {
    if (/FROM radcheck WHERE username/.test(sql)) return [p[0] === usernameGravado ? [{ value: senha }] : []];
    if (/FROM radacct/.test(sql)) return [aparelhoConhecido ? [{ 1: 1 }] : []];
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ ip: '10.0.0.1', end_hotspot: 'hs.local', empresa_id: mkEmpresa }]];
    if (/FROM radius_users WHERE username/.test(sql)) return [donoEmpresa ? [{ empresa_id: donoEmpresa }] : []];
    return undefined;
  });
  return carregar('src/controllers/loginPortalController.js', {
    db,
    extras: {
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      ...(sessaoResp ? { 'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async (a) => { sessaoResp.chamado = a; return sessaoResp.resp; } } } : {}),
    },
  });
}
const tentar = async (c, body, ip = '7.7.7.7') => {
  const res = criarRes(); const un = silencia();
  try { await c.login(criarReq({ body: { mikrotik_id: 3, mac: 'AA:BB:CC:DD:EE:01', ...body }, ip }), res); } finally { un(); }
  return res;
};

test('login-portal: senha aleatoria correta => 200 com a credencial canonica', async () => {
  const c = ctrl();
  const res = await tentar(c, { username: '529.982.247-25', password: 'abc23456' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.password, 'abc23456');
});

test('login-portal: usuario inexistente e senha errada dao a MESMA resposta (sem enumeracao)', async () => {
  const c = ctrl();
  const a = await tentar(c, { username: '11122233396', password: 'x' });
  const b = await tentar(c, { username: '52998224725', password: 'errada' });
  assert.strictEqual(a.statusCode, 401);
  assert.strictEqual(b.statusCode, 401);
  assert.deepStrictEqual(a.body, b.body);
});

test('login-portal: 10 erros do mesmo IP no mesmo usuario => 429, mesmo com a senha certa depois', async () => {
  const c = ctrl();
  for (let i = 0; i < 10; i++) assert.strictEqual((await tentar(c, { username: '52998224725', password: `err${i}` })).statusCode, 401);
  assert.strictEqual((await tentar(c, { username: '52998224725', password: 'abc23456' })).statusCode, 429);
  // outro IP nao e trancado por quem erra (o dono nao fica de fora)
  assert.strictEqual((await tentar(c, { username: '52998224725', password: 'abc23456' }, '8.8.8.8')).statusCode, 200);
});

test('login-portal: senha legada (== username) so no aparelho que ja usou o acesso', async () => {
  const desconhecido = ctrl({ senha: '52998224725', aparelhoConhecido: false });
  assert.strictEqual((await tentar(desconhecido, { username: '52998224725', password: '52998224725' })).statusCode, 401);
  const conhecido = ctrl({ senha: '52998224725', aparelhoConhecido: true });
  assert.strictEqual((await tentar(conhecido, { username: '52998224725', password: '529.982.247-25' })).statusCode, 200);
});

test('login-portal: acesso de outra empresa nao autentica no gateway desta', async () => {
  const c = ctrl({ donoEmpresa: 9, mkEmpresa: 5 });
  assert.strictEqual((await tentar(c, { username: '52998224725', password: 'abc23456' })).statusCode, 401);
});

test('login-portal: acesso aberto em OUTRO aparelho => requer_desconexao junto com as credenciais', async () => {
  const sessaoResp = { resp: { requer_desconexao: true, sessao_ativa: { desde: null, aparelho: '…64:F4' } } };
  const c = ctrl({ sessaoResp });
  const res = await tentar(c, { username: '529.982.247-25', password: 'abc23456' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.requer_desconexao, true);
  assert.strictEqual(res.body.password, 'abc23456');
  assert.deepStrictEqual(sessaoResp.chamado, { username: '52998224725', mac: 'AA:BB:CC:DD:EE:01', empresaId: 5 });
});

test('login-portal: sem sessao aberta => resposta igual a de antes', async () => {
  const c = ctrl({ sessaoResp: { resp: {} } });
  const res = await tentar(c, { username: '52998224725', password: 'abc23456' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.requer_desconexao, undefined);
});
