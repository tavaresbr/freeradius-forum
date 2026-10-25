// pix-trial: prova de posse (IDOR) e aviso de sessao aberta em outro aparelho.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

const PAG = { id: 4, mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.5', cpf: '529.982.247-25', cliente_id: 77, portal_id: 2, plano_id: 9, empresa_id: 5, status: 'aguardando', trial_liberado_em: null,
  mikrotik_id: 3, plano_nome: 'Plano 1h', portal_config: JSON.stringify({ pix_trial_enabled: true, pix_trial_duracao_minutos: 5 }) };

function montar({ sessaoResp = {}, pagExtra = {} } = {}) {
  const estado = { acesso: 0, tratar: [] };
  const db = criarDb(async (sql, p) => {
    if (/FROM pagamentos p LEFT JOIN planos/.test(sql)) {
      // so devolve o registro se a prova de posse bater (id + mp_pagamento_id + mac)
      return [[(p[0] === 4 && p[1] === '999' && String(p[2]).toLowerCase() === PAG.mac) ? { ...PAG, ...pagExtra } : undefined]];
    }
    if (/trial_liberado_em IS NOT NULL/.test(sql)) return [[]];
    return undefined;
  });
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k];
  const mod = carregar('src/controllers/pagamentoController.js', {
    db,
    extras: {
      'src/controllers/mikrotikAPIController.js': { liberarUsuario: async () => ({}) },
      'src/controllers/authTempController.js': { gerarAcessoTemporario: async () => { estado.acesso++; return { username: '52998224725', password: 'senhaNova1', gateway: 'hs.local' }; } },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async (a) => { estado.tratar.push(a); return sessaoResp; } },
    },
  });
  return { mod, db, estado };
}
const chamar = async (mod, body) => { const res = criarRes(); const un = silencia(); try { await mod.liberarPixTrial(criarReq({ body }), res); } finally { un(); } return res; };
const gravouTrial = (db) => db.calls.some((c) => /SET trial_liberado_em = NOW\(\)/.test(c.sql));
const BOM = { pagamento_id: 4, mp_pagamento_id: '999', mac: 'AA:BB:CC:DD:EE:FF' };

test('pix-trial: sem mp_pagamento_id ou mac => 400 (so o id interno nao basta)', async () => {
  const { mod, estado } = montar();
  assert.strictEqual((await chamar(mod, { pagamento_id: 4 })).statusCode, 400);
  assert.strictEqual((await chamar(mod, { pagamento_id: 4, mp_pagamento_id: '999' })).statusCode, 400);
  assert.strictEqual(estado.acesso, 0);
});

test('pix-trial: id certo com mp_pagamento_id ou MAC de outro => 404 e o RADIUS NAO e tocado (IDOR)', async () => {
  const { mod, db, estado } = montar();
  assert.strictEqual((await chamar(mod, { ...BOM, mp_pagamento_id: '123' })).statusCode, 404);
  assert.strictEqual((await chamar(mod, { ...BOM, mac: '11:22:33:44:55:66' })).statusCode, 404);
  assert.strictEqual(estado.acesso, 0);
  assert.ok(!gravouTrial(db));
});

test('pix-trial: prova certa e sem sessao aberta => credenciais como antes e trial gravado', async () => {
  const { mod, db, estado } = montar();
  const res = await chamar(mod, BOM);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.password, 'senhaNova1');
  assert.strictEqual(estado.acesso, 1);
  assert.ok(gravouTrial(db));
  assert.deepStrictEqual(estado.tratar, [{ username: '52998224725', mac: PAG.mac, empresaId: 5, manterMesmoAparelho: true }]);
});

test('pix-trial: CPF conectado em OUTRO aparelho => requer_desconexao, sem tocar no RADIUS nem gastar trial', async () => {
  const { mod, db, estado } = montar({ sessaoResp: { requer_desconexao: true, sessao_ativa: { desde: null, aparelho: '…64:F4' } } });
  const res = await chamar(mod, BOM);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, false);
  assert.strictEqual(res.body.requer_desconexao, true);
  assert.strictEqual(res.body.username, '52998224725');
  assert.ok(!res.body.password, 'nenhuma senha antes de o titular decidir');
  assert.strictEqual(estado.acesso, 0);
  assert.ok(!gravouTrial(db));
});

test('pix-trial: 1 vez por pagamento — trial_liberado_em preenchido => 409 ja_liberado e o RADIUS NAO e tocado', async () => {
  const { mod, db, estado } = montar({ pagExtra: { trial_liberado_em: new Date() } });
  const res = await chamar(mod, BOM);
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.ja_liberado, true);
  assert.strictEqual(estado.acesso, 0);
  assert.ok(!gravouTrial(db));
});

test('pix-trial: pagamento ja aprovado ou expirado => 409 sem tocar no RADIUS', async () => {
  for (const status of ['approved', 'expirado']) {
    const { mod, estado } = montar({ pagExtra: { status } });
    const res = await chamar(mod, BOM);
    assert.strictEqual(res.statusCode, 409);
    assert.ok(!res.body.ja_liberado);
    assert.strictEqual(estado.acesso, 0);
  }
});

test('pix-trial: a 2a chamada do MESMO pagamento (depois de liberado) nao regrava credenciais', async () => {
  const { mod, estado } = montar();
  assert.strictEqual((await chamar(mod, BOM)).statusCode, 200);
  assert.strictEqual(estado.acesso, 1);
  // o banco real passaria a ter trial_liberado_em; simulado com um 2o modulo ja marcado
  const { mod: mod2, estado: estado2 } = montar({ pagExtra: { trial_liberado_em: new Date() } });
  assert.strictEqual((await chamar(mod2, BOM)).statusCode, 409);
  assert.strictEqual(estado2.acesso, 0);
});
