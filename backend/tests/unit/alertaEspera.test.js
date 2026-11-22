// Aviso ao proprietario de cliente esperando no chat: config, mensagem e job (reserva atomica, dedupe, travas).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const ae = require('../../src/utils/alertaEspera');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/jobs/alertaEspera.js', 'src/utils/schemaCache.js', 'src/controllers/atendimentoAutomacaoController.js', 'src/services/whatsappAutomacao.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);

test('validarAlertaEspera: minutos 2-240, telefones validos/unicos ate 3, ativo exige telefone', () => {
  const ok = ae.validarAlertaEspera({ ativo: true, minutos: 15, telefones: ['(93) 99999-0000', '93999990000', ''], somente_horario: true });
  assert.deepStrictEqual([ok.ativo, ok.minutos, ok.telefones.length, ok.somente_horario], [true, 15, 1, true]);
  assert.throws(() => ae.validarAlertaEspera({ minutos: 1 }), /entre 2 e 240/);
  assert.throws(() => ae.validarAlertaEspera({ minutos: 241 }), /entre 2 e 240/);
  assert.throws(() => ae.validarAlertaEspera({ minutos: 10, telefones: ['123'] }), /Telefone inválido/);
  assert.throws(() => ae.validarAlertaEspera({ minutos: 10, telefones: ['93999990001', '93999990002', '93999990003', '93999990004'] }), /Máximo de 3/);
  assert.throws(() => ae.validarAlertaEspera({ ativo: true, minutos: 10, telefones: [] }), /ao menos um telefone/);
  assert.strictEqual(ae.validarAlertaEspera({ minutos: 10 }).ativo, false);
  assert.strictEqual(ae.padrao().ativo, false);
});

test('montarMensagem: lista, nunca o numero inteiro, limita a 5 e traz o link', () => {
  const itens = [
    { nome: 'Maria Souza', espera_min: 12 },
    { telefone: '5593999991234', espera_min: 130 },
    ...Array.from({ length: 5 }, (_, i) => ({ nome: `C${i}`, espera_min: 5 })),
  ];
  const m = ae.montarMensagem(itens, 'https://x.com/admin/acme/atendimento/conversas');
  assert.match(m, /7 clientes esperando/);
  assert.match(m, /• Maria Souza — há 12 min/);
  assert.match(m, /• \*\*\*1234 — há 2 h/);
  assert.match(m, /\+ 2 outro\(s\)/);
  assert.match(m, /Abrir: https:\/\/x\.com/);
  assert.ok(!m.includes('5593999991234'));
  assert.match(ae.montarMensagem([{ nome: 'Ana', espera_min: 0.2 }], ''), /^⏰ 1 cliente esperando[\s\S]*há 1 min$/);
});

const AGORA = new Date('2026-11-22T15:00:00Z');
const montar = ({ cfg, colunas = true, recurso = true, conectada = true, esperas = [], reserva = 1, falhaEnvio = false } = {}) => {
  limpar();
  const enviados = [];
  const logs = [];
  const reservas = [];
  const devolvidas = [];
  const db = criarDb((sql, p) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
    if (/FROM empresa_configs/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify(cfg) }]];
    if (/SELECT slug FROM empresas/.test(sql)) return [[{ slug: 'acme' }]];
    if (/SET espera_avisada_em = NOW\(\)/.test(sql)) { reservas.push(p); return [{ affectedRows: reserva }]; }
    if (/SET espera_avisada_em = NULL/.test(sql)) { devolvidas.push(p); return [{}]; }
    if (/FROM whatsapp_conversas c\s+JOIN/.test(sql)) return [esperas];
    if (/c\.chatbot_estado = 'humano'/.test(sql)) return [[]];
  });
  process.env.SYSTEM_DOMAIN = 'painel.exemplo.com';
  const job = carregar('src/jobs/alertaEspera.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': {
        instanciaConectada: async () => conectada,
        enviarMensagemEstrita: async (tel, msg) => { if (falhaEnvio) throw new Error('evolution fora'); enviados.push([tel, msg]); },
      },
      'src/services/whatsappNotify.js': { normalizarTelefone: (t) => String(t).replace(/\D/g, ''), gravarLog: async (l) => { logs.push(l); } },
    },
  });
  return { job, db, enviados, logs, reservas, devolvidas };
};
const on = { alerta_espera: { ativo: true, minutos: 10, telefones: ['5593999990000', '5593999990001'], somente_horario: false } };
const espera = (id, nome, minAtras) => ({ id, nome, telefone: '5593988887777', desde: new Date(AGORA - minAtras * 60000) });

test('job: avisa UMA mensagem com a lista aos telefones da config e reserva cada conversa', async () => {
  const t = montar({ cfg: on, esperas: [espera(1, 'Maria', 25), espera(2, 'João', 12)] });
  const r = await t.job({ dormir: async () => {}, agora: AGORA });
  assert.deepStrictEqual(r, { avisadas: 2 });
  assert.strictEqual(t.enviados.length, 2); // 2 telefones, 1 mensagem cada
  assert.match(t.enviados[0][1], /2 clientes esperando/);
  assert.match(t.enviados[0][1], /Maria — há 25 min/);
  assert.match(t.enviados[0][1], /Abrir: https:\/\/painel\.exemplo\.com\/admin\/acme\/atendimento\/conversas/);
  assert.strictEqual(t.reservas.length, 2);
  assert.ok(t.logs.every((l) => l.contexto_tipo === 'alerta_espera' && l.status === 'ok'));
});

test('job: respeita desligado, sem recurso, sem a migration, WhatsApp desconectado e fora do horario (sem reservar nada)', async () => {
  const casos = [
    [{ cfg: { alerta_espera: { ...on.alerta_espera, ativo: false } } }],
    [{ cfg: on, recurso: false }],
    [{ cfg: on, colunas: false }],
    [{ cfg: on, conectada: false }],
    [{ cfg: { ...on, automacao: { usar_horario: true, fuso: 'America/Sao_Paulo', horarios: Array.from({ length: 7 }, () => ({ ativo: false, de: '08:00', ate: '18:00' })) }, alerta_espera: { ...on.alerta_espera, somente_horario: true } } }],
  ];
  for (const [opts] of casos) {
    const t = montar({ ...opts, esperas: [espera(1, 'Maria', 25)] });
    const r = await t.job({ dormir: async () => {}, agora: AGORA });
    assert.deepStrictEqual(r, { avisadas: 0 });
    assert.strictEqual(t.enviados.length, 0);
    assert.strictEqual(t.reservas.length, 0);
  }
});

test('job: reserva ja feita por outra execucao = nao repete; sem espera = nada', async () => {
  let t = montar({ cfg: on, esperas: [espera(1, 'Maria', 25)], reserva: 0 });
  assert.deepStrictEqual(await t.job({ dormir: async () => {}, agora: AGORA }), { avisadas: 0 });
  assert.strictEqual(t.enviados.length, 0);
  t = montar({ cfg: on, esperas: [] });
  assert.deepStrictEqual(await t.job({ dormir: async () => {}, agora: AGORA }), { avisadas: 0 });
});

test('job: se ninguem recebeu (Evolution fora) devolve a reserva para tentar de novo', async () => {
  const t = montar({ cfg: on, esperas: [espera(1, 'Maria', 25), espera(2, 'João', 12)], falhaEnvio: true });
  assert.deepStrictEqual(await t.job({ dormir: async () => {}, agora: AGORA }), { avisadas: 0 });
  assert.strictEqual(t.devolvidas.length, 1);
  assert.deepStrictEqual(t.devolvidas[0], [7, 1, 2]);
  assert.ok(t.logs.every((l) => l.status === 'erro'));
});

test('consulta: so conversa aberta, sem resposta de ninguem apos a mensagem do cliente, janela de 24 h e 1 aviso por espera', async () => {
  const t = montar({ cfg: on, esperas: [] });
  await t.job({ dormir: async () => {}, agora: AGORA });
  const q = t.db.calls.find((c) => /FROM whatsapp_conversas c\s+JOIN/.test(c.sql));
  assert.match(q.sql, /c\.empresa_id = \? AND c\.status = 'aberta'/);
  assert.match(q.sql, /m\.direcao = 'in'/);
  assert.match(q.sql, /o\.direcao = 'out'/);
  assert.match(q.sql, /INTERVAL 24 HOUR/);
  assert.match(q.sql, /espera_avisada_em IS NULL OR c\.espera_avisada_em < x\.desde/);
  assert.deepStrictEqual(q.params, [7, 7, 10]);
  const b = t.db.calls.find((c) => /chatbot_estado = 'humano'/.test(c.sql));
  assert.match(b.sql, /o\.automatica = 0/); // IA/automatica nao conta como atendimento humano
});

test('API: GET/PUT/teste respeitam a validacao e a migration', async () => {
  limpar();
  let temCol = true;
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: temCol ? 1 : 0 }]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify(on) }]];
  });
  const sent = [];
  const c = carregar('src/controllers/atendimentoAutomacaoController.js', {
    db,
    extras: { 'src/controllers/whatsappController.js': { enviarMensagemEstrita: async (...a) => { sent.push(a); } }, 'src/services/whatsappNotify.js': { renderTemplate: () => '', normalizarTelefone: (t) => String(t).replace(/\D/g, '') || null, gravarLog: async () => {} } },
  });
  let res = criarRes();
  await c.obterAlertaEspera(criarReq({ empresa_id: 7 }), res);
  assert.strictEqual(res.body.alerta.minutos, 10);
  res = criarRes();
  await c.salvarAlertaEspera(criarReq({ empresa_id: 7, body: { ativo: true, minutos: 0, telefones: ['93999990000'] } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.salvarAlertaEspera(criarReq({ empresa_id: 7, body: { ativo: true, minutos: 10, telefones: ['93999990000'] } }), res);
  assert.strictEqual(res.statusCode, 200);
  temCol = false; limpar();
  res = criarRes();
  const c2 = carregar('src/controllers/atendimentoAutomacaoController.js', { db, extras: { 'src/controllers/whatsappController.js': { enviarMensagemEstrita: async () => {} } } });
  await c2.salvarAlertaEspera(criarReq({ empresa_id: 7, body: { ativo: true, minutos: 10, telefones: ['93999990000'] } }), res);
  assert.strictEqual(res.statusCode, 503);
  res = criarRes();
  await c.testarAlertaEspera(criarReq({ empresa_id: 7, body: { telefone: '' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.testarAlertaEspera(criarReq({ empresa_id: 7, body: { telefone: '93999990000' } }), res);
  assert.strictEqual(res.body.success, true);
  assert.match(sent[0][1], /^\[TESTE\] ⏰ 2 clientes esperando/);
});
