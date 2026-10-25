// PIX: apos aprovado, se o acesso pago ja esta aberto em OUTRO aparelho a resposta do polling pede a decisao do cliente.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };

function montar({ status = 'approved', senha = 'senhaReal9', sessaoResp = {} } = {}) {
  const db = criarDb(async (sql) => {
    if (/FROM pagamentos WHERE mp_pagamento_id/.test(sql)) {
      return [[{ id: 4, status, nome_plano: 'Plano 1h', empresa_id: 5, cpf: '529.982.247-25', cliente_id: 77, portal_id: null, telefone: null }]];
    }
    if (/FROM mikrotiks m JOIN planos/.test(sql)) return [[{ mikrotik_id: 3, end_hotspot: 'hs.local', ip: '10.0.0.1' }]];
    if (/UPDATE pagamentos SET liberado_em = NOW\(\)/.test(sql)) return [{ affectedRows: 0 }]; // outro caminho (webhook) ja liberou
    return undefined;
  });
  const chamadas = [];
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k];
  const mod = carregar('src/controllers/pagamentoController.js', {
    db,
    extras: {
      'src/controllers/mikrotikAPIController.js': { liberarUsuario: async () => ({}) },
      'src/utils/radiusPassword.js': { obterSenhaRadius: async () => senha },
      'src/gateways/gatewayLiberacao.js': { montarGatewayInfo: async () => ({ tipo: 'mikrotik' }) },
      'src/utils/sessaoAtiva.js': { tratarSessaoAtiva: async (a) => { chamadas.push(a); return sessaoResp; } },
    },
  });
  return { mod, chamadas };
}
const consulta = () => criarReq({ query: { pagamento_id: '123', mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.5' } });

test('PIX aprovado + sessao em outro aparelho => requer_desconexao junto com as credenciais', async () => {
  const { mod, chamadas } = montar({ sessaoResp: { requer_desconexao: true, sessao_ativa: { desde: null, aparelho: '…64:F4' } } });
  const res = criarRes(); const un = silencia();
  try { await mod.verificarStatusPagamento(consulta(), res); } finally { un(); }
  assert.strictEqual(res.body.status, 'approved');
  assert.strictEqual(res.body.requer_desconexao, true);
  assert.strictEqual(res.body.username, '52998224725');
  assert.strictEqual(res.body.password, 'senhaReal9');
  assert.deepStrictEqual(chamadas, [{ username: '52998224725', mac: 'AA:BB:CC:DD:EE:FF', empresaId: 5, manterMesmoAparelho: true }]);
});

test('PIX aprovado sem sessao aberta => resposta igual a de antes (sem requer_desconexao)', async () => {
  const { mod } = montar();
  const res = criarRes(); const un = silencia();
  try { await mod.verificarStatusPagamento(consulta(), res); } finally { un(); }
  assert.strictEqual(res.body.status, 'approved');
  assert.strictEqual(res.body.requer_desconexao, undefined);
  assert.strictEqual(res.body.password, 'senhaReal9');
});

test('PIX ainda pendente NAO consulta sessoes', async () => {
  const { mod, chamadas } = montar({ status: 'pending' });
  const res = criarRes(); const un = silencia();
  try { await mod.verificarStatusPagamento(consulta(), res); } finally { un(); }
  assert.strictEqual(res.body.status, 'pending');
  assert.strictEqual(chamadas.length, 0);
});
