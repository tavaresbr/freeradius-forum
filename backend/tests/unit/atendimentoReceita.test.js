// Atendimento WhatsApp (receita): aviso de expiracao, saldo no painel, link de planos e filtro de reativacao.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const aviso = require('../../src/utils/avisoExpiracao');
const { montarLinkPlanos } = require('../../src/utils/linkPlanos');
const { montarFiltroLeads, sanitizarFiltros } = require('../../src/utils/promocaoWhatsapp');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/jobs/avisaExpiracao.js', 'src/controllers/atendimentoAutomacaoController.js', 'src/controllers/atendimentoExtrasController.js', 'src/services/whatsappAutomacao.js', 'src/utils/linkPlanos.js', 'src/utils/schemaCache.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

test('validarAviso: minutos 5-60, mensagem obrigatoria quando ativo, tamanho maximo', () => {
  assert.deepStrictEqual(aviso.validarAviso({ ativo: true, minutos: 10, template: 'Oi {{nome}}' }), { ativo: true, minutos: 10, template: 'Oi {{nome}}' });
  assert.throws(() => aviso.validarAviso({ ativo: false, minutos: 4, template: '' }), /entre 5 e 60/);
  assert.throws(() => aviso.validarAviso({ ativo: false, minutos: 61, template: '' }), /entre 5 e 60/);
  assert.throws(() => aviso.validarAviso({ ativo: true, minutos: 10, template: ' ' }), /Escreva a mensagem/);
  assert.throws(() => aviso.validarAviso({ ativo: false, minutos: 10, template: 'x'.repeat(1001) }), /máximo/);
  assert.strictEqual(aviso.mesclarComPadrao(undefined).ativo, false); // desligado por padrao
});

test('montarLinkPlanos: so com host e equipamento; cliente_id opcional', () => {
  assert.strictEqual(montarLinkPlanos('portal.exemplo.com', { empresaId: 7, mikrotikId: 3, clienteId: 9 }), 'https://portal.exemplo.com/planos-cliente?empresa_id=7&mikrotik_id=3&cliente_id=9');
  assert.strictEqual(montarLinkPlanos('portal.exemplo.com', { empresaId: 7, mikrotikId: 3 }), 'https://portal.exemplo.com/planos-cliente?empresa_id=7&mikrotik_id=3');
  assert.strictEqual(montarLinkPlanos(null, { empresaId: 7, mikrotikId: 3 }), null);
  assert.strictEqual(montarLinkPlanos('x.com', { empresaId: 7, mikrotikId: null }), null);
});

test('reativacao: inativo_dias exige MAC, cadastro antigo e nenhuma sessao no periodo; valores invalidos sao descartados', () => {
  assert.strictEqual(sanitizarFiltros({ inativo_dias: '30' }).inativo_dias, 30);
  assert.strictEqual(sanitizarFiltros({ inativo_dias: 0 }).inativo_dias, undefined);
  assert.strictEqual(sanitizarFiltros({ inativo_dias: 99999 }).inativo_dias, undefined);
  assert.strictEqual(sanitizarFiltros({ inativo_dias: 'abc' }).inativo_dias, undefined);
  const { where, params } = montarFiltroLeads({ inativo_dias: 45, status: ['novo'] }, 7);
  assert.match(where, /empresa_id = \?/);
  assert.match(where, /mac IS NOT NULL/);
  assert.match(where, /criado_em < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
  assert.match(where, /NOT EXISTS \(SELECT 1 FROM radacct ra/);
  assert.match(where, /whatsapp_optout = 0/);
  assert.strictEqual((where.match(/\?/g) || []).length, params.length);
  assert.deepStrictEqual(params, [7, 'novo', 45, 45]);
  assert.doesNotMatch(montarFiltroLeads({}, 7).where, /radacct/);
});

// ---------- job ----------
const sessao = { username: '12345678909', liberado_em: new Date('2026-10-29T10:00:00Z'), nas_id: 3, plano: 'Plano 1h', restante: 540 };
const notifyReal = require('../../src/services/whatsappNotify');
const rodar = async ({ cfg, sessoes = [sessao], lead = { id: 9, nome: 'Maria Souza', telefone: '93999990000', whatsapp_optout: 0 }, claim = 1, recurso = true, conectada = true, falha = false }) => {
  limpar();
  const enviados = [];
  const logs = [];
  const db = criarDb((sql) => {
    if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify({ aviso_expiracao: cfg }) }]];
    if (/FROM radius_users ru0/.test(sql)) return [sessoes];
    if (/FROM leads/.test(sql) && !/whatsapp_optout = 1/.test(sql)) return [lead ? [lead] : []];
    if (/INSERT IGNORE INTO whatsapp_avisos_expiracao/.test(sql)) return [{ affectedRows: claim }];
    if (/FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
  });
  const job = carregar('src/jobs/avisaExpiracao.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { if (falha) throw new Error('boom'); enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
      'src/utils/dominioPortal.js': { portalHostDaEmpresa: async () => 'portal.exemplo.com' },
    },
  });
  const r = await job({ dormir: async () => {} });
  return { db, enviados, logs, r };
};
const cfgOn = { ativo: true, minutos: 10, template: 'Oi {{nome}}, faltam {{minutos}} min: {{link}}' };

test('job: avisa quem esta no fim do tempo, com 1o nome, minutos e link; grava o log', async () => {
  const { enviados, db, logs } = await rodar({ cfg: cfgOn });
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0][2], 7);
  assert.match(enviados[0][1], /^Oi Maria, faltam 9 min: https:\/\/portal\.exemplo\.com\/planos-cliente\?empresa_id=7&mikrotik_id=3&cliente_id=9$/);
  assert.strictEqual(logs[0].contexto_tipo, 'aviso_expiracao');
  assert.strictEqual(logs[0].status, 'ok');
  const q = db.calls.find((c) => /FROM radius_users ru0/.test(c.sql));
  assert.deepStrictEqual(q.params, [7, 7, 600]); // escopado por empresa e limite em segundos
});

test('job: nao avisa se desligado, sem recurso, desconectado, opt-out, ja avisado, sem telefone ou username que nao e CPF', async () => {
  const casos = [
    { cfg: { ...cfgOn, ativo: false } },
    { cfg: cfgOn, recurso: false },
    { cfg: cfgOn, conectada: false },
    { cfg: cfgOn, lead: { id: 9, nome: 'M', telefone: '93999990000', whatsapp_optout: 1 } },
    { cfg: cfgOn, claim: 0 },
    { cfg: cfgOn, lead: { id: 9, nome: 'M', telefone: '123', whatsapp_optout: 0 } },
    { cfg: cfgOn, lead: null },
    { cfg: cfgOn, sessoes: [{ ...sessao, username: 'AABBCCDDEEFF' }] },
    { cfg: cfgOn, sessoes: [{ ...sessao, username: 'voucher_ABC12345' }] },
  ];
  for (const c of casos) assert.strictEqual((await rodar(c)).enviados.length, 0);
});

test('job: falha de envio vira log de erro e nao derruba a rodada', async () => {
  const restaurar = semLog();
  try {
    const { logs, enviados } = await rodar({ cfg: cfgOn, falha: true });
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(logs[0].status, 'erro');
  } finally { restaurar(); }
});

// ---------- controller ----------
const ctrlReq = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: {}, body: {}, ...over });

test('aviso: salvar valida e preserva o resto da config; teste manda 1 mensagem marcada [TESTE]', async () => {
  limpar();
  const enviados = [];
  const db = criarDb((sql) => {
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: '{"api_key":"k","automacao":{"ativo":true}}' }]];
    if (/SELECT id FROM empresa_configs/.test(sql)) return [[{ id: 1 }]];
    if (/FROM mikrotiks/.test(sql)) return [[{ id: 3 }]];
  });
  const c = carregar('src/controllers/atendimentoAutomacaoController.js', {
    db,
    extras: {
      'src/controllers/whatsappController.js': { enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/utils/dominioPortal.js': { portalHostDaEmpresa: async () => 'portal.exemplo.com' },
    },
  });
  let res = criarRes();
  await c.salvarAviso(ctrlReq({ body: { ativo: true, minutos: 15, template: 'Oi {{nome}}' } }), res);
  assert.strictEqual(res.body.success, true);
  const salvo = JSON.parse(db.calls.find((x) => /UPDATE empresa_configs SET config_json/.test(x.sql)).params[0]);
  assert.strictEqual(salvo.api_key, 'k');
  assert.strictEqual(salvo.automacao.ativo, true);
  assert.deepStrictEqual(salvo.aviso_expiracao, { ativo: true, minutos: 15, template: 'Oi {{nome}}' });

  res = criarRes();
  await c.salvarAviso(ctrlReq({ body: { ativo: true, minutos: 1, template: 'x' } }), res);
  assert.strictEqual(res.statusCode, 400);

  res = criarRes();
  await c.testarAviso(ctrlReq({ body: { telefone: '(93) 99999-0000', template: 'Faltam {{minutos}} min {{link}}', minutos: 10 } }), res);
  assert.strictEqual(res.body.success, true);
  assert.match(enviados[0][1], /^\[TESTE\] Faltam 10 min https:\/\/portal\.exemplo\.com\/planos-cliente/);
  res = criarRes();
  await c.testarAviso(ctrlReq({ body: { telefone: '12' } }), res);
  assert.strictEqual(res.statusCode, 400);
});

test('painel do cliente: devolve saldo de tempo (CPF so do banco) e link de planos do cliente', async () => {
  limpar();
  const db = criarDb((sql, p) => {
    if (/FROM empresas WHERE id/.test(sql)) return [[{ nome: 'Apex' }]];
    if (/SELECT \* FROM whatsapp_conversas WHERE id = \? AND empresa_id = \?/.test(sql)) return [[{ id: 5, lead_id: 9, telefone: '5593999990000' }]];
    if (/SELECT \* FROM leads WHERE id = \? AND empresa_id = \?/.test(sql)) return [[{ id: 9, nome: 'Maria', cpf: '123.456.789-09', status: 'novo' }]];
    if (/FROM radius_users ru LEFT JOIN planos/.test(sql)) return [[{ nome: 'Plano 1h', duracao_minutos: 60, nas_id: 3 }]];
    if (/FROM mikrotiks WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[{ id: 3 }]] : [[]];
  });
  const c = carregar('src/controllers/atendimentoExtrasController.js', {
    db,
    extras: {
      'src/controllers/whatsappController.js': { getEvolutionConfig: async () => ({}), formatarNumeroComNonoDigito: (n) => n },
      'src/utils/leadUtils.js': { verificarSaldoRadius: async (u) => (u === '12345678909' ? { existe: true, temSaldo: true, tempoRestante: 1800 } : { existe: false }) },
      'src/utils/dominioPortal.js': { portalHostDaEmpresa: async () => 'portal.exemplo.com' },
    },
  });
  const res = criarRes();
  await c.clienteDaConversa(ctrlReq({ params: { id: '5' } }), res);
  assert.deepStrictEqual(res.body.saldo, { ativo: true, restante_segundos: 1800 });
  assert.strictEqual(res.body.link_planos, 'https://portal.exemplo.com/planos-cliente?empresa_id=7&mikrotik_id=3&cliente_id=9');
  assert.strictEqual(res.body.lead.cpf.includes('456'), false); // CPF continua mascarado
});
