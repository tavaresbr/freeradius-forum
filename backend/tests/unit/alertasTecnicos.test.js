// Alertas tecnicos: config, registro no feed pelo job de equipamentos, aviso aos clientes (1 por alerta) e controller.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const at = require('../../src/utils/alertaTecnico');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };

test('validarConfig: faixa de minutos, mensagens padrao e aviso automatico exige monitoramento', () => {
  const ok = at.validarConfig({ ativo: true, avisar_clientes_auto: true, apos_minutos: 20, mensagem_queda: '  ' });
  assert.strictEqual(ok.apos_minutos, 20);
  assert.strictEqual(ok.mensagem_queda, at.MSG_QUEDA);
  assert.strictEqual(ok.avisar_volta, true);
  assert.throws(() => at.validarConfig({ ativo: true, apos_minutos: 1 }), /entre 5 e 240/);
  assert.throws(() => at.validarConfig({ ativo: false, avisar_clientes_auto: true }), /monitoramento/);
  assert.throws(() => at.validarConfig({ ativo: true, mensagem_volta: 'x'.repeat(1001) }), /máximo/);
  assert.strictEqual(at.mesclarComPadrao(undefined).ativo, false);
  assert.strictEqual(at.mesclarComPadrao(undefined).avisar_clientes_auto, false);
});

// ---------- job de equipamentos alimentando o feed ----------
const eq = { id: 3, empresa_id: 7, nome: 'Centro', ip: '10.0.0.1', tipo: 'mikrotik' };
async function rodar({ tec = { ativo: true }, equipe = false, ok = false, estado = { online: 0, falhas: 5, alertado: 1, falha_desde: new Date('2026-10-29T14:00:00Z') }, aberto = false, manutencao = false, conectada = true } = {}) {
  limpar();
  const enviados = [];
  const cfg = { alertas_tecnicos: tec };
  if (equipe) cfg.alerta_equipamentos = { ativo: true, telefones: ['5593999990000'], falhas: 3, avisar_volta: true };
  const db = criarDb(async (sql) => {
    if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify(cfg) }]];
    if (/FROM mikrotiks WHERE empresa_id/.test(sql)) return [[eq]];
    if (/FROM equipamento_status WHERE empresa_id/.test(sql)) return [[{ mikrotik_id: 3, ...estado }]];
    if (/FROM manutencoes WHERE empresa_id/.test(sql)) return [manutencao ? [{ equipamento_id: 3 }] : []];
    if (/SELECT id FROM alertas_tecnicos WHERE empresa_id/.test(sql)) return [aberto ? [{ id: 1 }] : []];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify(cfg) }]];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
  });
  const job = carregar('src/jobs/alertaEquipamentos.js', { db, extras: {
    'src/utils/assinatura.js': { temRecurso: async () => true },
    'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
    'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async () => {} },
  } });
  await job({ dormir: async () => {}, testar: async () => (ok ? { sucesso: true } : { sucesso: false, erro: 'sem resposta' }), agora: new Date('2026-10-29T15:00:00Z') });
  return { db, enviados };
}
const inseriu = (db, tipo) => db.calls.some((c) => /^INSERT INTO alertas_tecnicos/.test(c.sql) && c.params.includes(tipo));

test('feed: queda confirmada abre 1 alerta (sem duplicar) e NAO manda WhatsApp a equipe quando so o monitoramento esta ligado', async () => {
  let r = await rodar({});
  assert.ok(inseriu(r.db, 'equipamento_offline'));
  const ins = r.db.calls.find((c) => /^INSERT INTO alertas_tecnicos/.test(c.sql) && c.params.includes('equipamento_offline'));
  assert.strictEqual(ins.params[0], 7);
  assert.strictEqual(r.enviados.length, 0, 'sem equipe ligada nada e enviado');
  r = await rodar({ aberto: true });
  assert.ok(!inseriu(r.db, 'equipamento_offline'), 'ja existe alerta aberto');
});

test('feed: manutencao programada nao abre alerta; antes do limite de falhas tambem nao', async () => {
  assert.ok(!inseriu((await rodar({ manutencao: true })).db, 'equipamento_offline'));
  assert.ok(!inseriu((await rodar({ estado: { online: 1, falhas: 0, alertado: 0, falha_desde: null } })).db, 'equipamento_offline'));
});

test('feed: volta (responde) encerra o alerta aberto do equipamento escopado por empresa', async () => {
  const { db } = await rodar({ ok: true });
  const up = db.calls.find((c) => /^UPDATE alertas_tecnicos SET resolvido_em = NOW\(\)/.test(c.sql) && c.params[1] === 'equipamento_offline');
  assert.match(up.sql, /empresa_id = \? AND tipo = \? AND equipamento_id <=> \?/);
  assert.deepStrictEqual(up.params, [7, 'equipamento_offline', 3]);
});

test('feed: WhatsApp desconectado abre alerta so de painel; conectado encerra', async () => {
  assert.ok(inseriu((await rodar({ conectada: false })).db, 'whatsapp_desconectado'));
  const { db } = await rodar({ conectada: true });
  assert.ok(db.calls.some((c) => /^UPDATE alertas_tecnicos SET resolvido_em/.test(c.sql) && c.params[1] === 'whatsapp_desconectado'));
});

test('equipe ligada junto continua avisando por WhatsApp como antes', async () => {
  const r = await rodar({ equipe: true, estado: { online: 1, falhas: 2, alertado: 0, falha_desde: new Date('2026-10-29T14:50:00Z') } });
  assert.strictEqual(r.enviados.length, 1);
  assert.ok(inseriu(r.db, 'equipamento_offline'));
});

// ---------- servico: aviso aos clientes ----------
function servico({ alerta, claim = 1, envio = 55, silencio = false, pendentes = [] } = {}) {
  limpar();
  const criados = [];
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [silencio ? [{ config_json: JSON.stringify({ nao_perturbe: { ativo: true, fuso: 'UTC', de: '00:00', ate: '23:59', dias: [0, 1, 2, 3, 4, 5, 6], aplicar_a: ['alerta_tecnico'] } }) }] : []];
    if (/FROM alertas_tecnicos a LEFT JOIN mikrotiks/.test(sql)) return [alerta ? [alerta] : []];
    if (/^UPDATE alertas_tecnicos SET clientes_(volta_)?avisados_em = NOW\(\)/.test(sql)) return [{ affectedRows: claim }];
    if (/SELECT id, resolvido_em FROM alertas_tecnicos/.test(sql)) return [pendentes];
  });
  const svc = carregar('src/services/alertasTecnicos.js', { db, extras: { 'src/services/avisoClientes.js': { criarEnvioAviso: async (_db, o) => { criados.push(o); return envio; } } } });
  return { db, svc, criados };
}
const alertaBase = { id: 9, empresa_id: 7, tipo: 'equipamento_offline', equipamento_id: 3, equipamento_nome: 'Praça', titulo: 'Praça offline', criado_em: new Date('2026-10-29T14:00:00'), resolvido_em: null };
const tec = at.mesclarComPadrao({ ativo: true, avisar_clientes_auto: true });

test('avisarClientes: 1 aviso por alerta e tipo (reserva), mensagem renderizada, escopo da empresa e filtros origem=alerta', async () => {
  const s = servico({ alerta: alertaBase });
  const r = await s.svc.avisarClientes(7, 9, 'queda', tec);
  assert.deepStrictEqual([r.ok, r.envio_id], [true, 55]);
  assert.strictEqual(s.criados[0].empresaId, 7);
  assert.strictEqual(s.criados[0].equipamentoId, 3);
  assert.match(s.criados[0].mensagem, /instabilidade em Praça desde 29\/10 14:00/);
  assert.match(s.criados[0].mensagem, /\{\{nome\}\}/, 'nome fica para o worker');
  assert.deepStrictEqual(s.criados[0].filtros, { origem: 'alerta', alerta_id: 9, aviso: 'queda' });
  const sel = s.db.calls.find((c) => /FROM alertas_tecnicos a LEFT JOIN/.test(c.sql));
  assert.deepStrictEqual(sel.params, [9, 7]);
  const rep = servico({ alerta: alertaBase, claim: 0 });
  assert.strictEqual((await rep.svc.avisarClientes(7, 9, 'queda', tec)).motivo, 'ja_avisado');
  assert.strictEqual(rep.criados.length, 0);
});

test('avisarClientes: volta so com alerta resolvido; alerta de outro tipo ou de outra empresa nao avisa; erro devolve a reserva', async () => {
  assert.strictEqual((await servico({ alerta: alertaBase }).svc.avisarClientes(7, 9, 'volta', tec)).motivo, 'ainda_aberto');
  assert.strictEqual((await servico({ alerta: { ...alertaBase, tipo: 'whatsapp_desconectado' } }).svc.avisarClientes(7, 9, 'queda', tec)).motivo, 'tipo_sem_clientes');
  assert.strictEqual((await servico({ alerta: null }).svc.avisarClientes(7, 9, 'queda', tec)).motivo, 'nao_encontrado');
  const volta = servico({ alerta: { ...alertaBase, resolvido_em: new Date('2026-10-29T14:30:00') } });
  assert.strictEqual((await volta.svc.avisarClientes(7, 9, 'volta', tec)).ok, true);
  assert.match(volta.criados[0].mensagem, /normalizada/);
  const falha = servico({ alerta: alertaBase });
  falha.svc = carregar('src/services/alertasTecnicos.js', { db: falha.db, extras: { 'src/services/avisoClientes.js': { criarEnvioAviso: async () => { throw new Error('boom'); } } } });
  await assert.rejects(() => falha.svc.avisarClientes(7, 9, 'queda', tec), /boom/);
  assert.ok(falha.db.calls.some((c) => /SET clientes_avisados_em = NULL/.test(c.sql)), 'reserva devolvida');
});

test('avisarPendentes: desligado ou no silencio nao faz nada; ligado avisa queda e volta dos alertas vencidos', async () => {
  assert.strictEqual(await servico({}).svc.avisarPendentes(7, { ...tec, avisar_clientes_auto: false }), 0);
  const sil = servico({ pendentes: [{ id: 9, resolvido_em: null }], silencio: true });
  assert.strictEqual(await sil.svc.avisarPendentes(7, tec), 0);
  assert.ok(!sil.db.calls.some((c) => /SELECT id, resolvido_em FROM alertas_tecnicos/.test(c.sql)), 'adiou antes de consultar');
  const s = servico({ alerta: alertaBase, pendentes: [{ id: 9, resolvido_em: null }] });
  assert.strictEqual(await s.svc.avisarPendentes(7, tec), 1);
  const q = s.db.calls.find((c) => /SELECT id, resolvido_em FROM alertas_tecnicos/.test(c.sql));
  assert.match(q.sql, /empresa_id = \?/);
  assert.deepStrictEqual(q.params, [7, 15, 1]);
});

// ---------- controller ----------
function controller(handler, extras = {}) {
  limpar();
  const db = criarDb(handler);
  return { db, ctrl: carregar('src/controllers/alertasTecnicosController.js', { db, extras: { 'src/controllers/whatsappController.js': { instanciaConectada: async () => true, ...extras } } }) };
}
const req = (o) => criarReq({ empresa_id: 7, user: { id: 2 }, ...o });

test('controller: alerta manual valida titulo/equipamento da empresa; resolver so manual da empresa', async () => {
  const c = controller(async (sql) => {
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[]];
    if (/^INSERT INTO alertas_tecnicos/.test(sql)) return [{ insertId: 4 }];
    if (/^UPDATE alertas_tecnicos SET resolvido_em/.test(sql)) return [{ affectedRows: 0 }];
  });
  let res = criarRes();
  await c.ctrl.criarManual(req({ body: { titulo: ' ' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.ctrl.criarManual(req({ body: { titulo: 'Fibra rompida', equipamento_id: 99 } }), res);
  assert.match(res.body.error, /Equipamento/);
  res = criarRes();
  await c.ctrl.criarManual(req({ body: { titulo: 'Fibra rompida' } }), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(c.db.calls.find((x) => /^INSERT INTO alertas_tecnicos/.test(x.sql)).params[0], 7);
  res = criarRes();
  await c.ctrl.resolver(req({ params: { id: '4' } }), res);
  assert.strictEqual(res.statusCode, 404);
  const up = c.db.calls.find((x) => /^UPDATE alertas_tecnicos SET resolvido_em/.test(x.sql));
  assert.match(up.sql, /tipo = 'manual'/);
  assert.deepStrictEqual(up.params, [4, 7]);
});

test('controller: avisar exige confirmacao e WhatsApp conectado; listar escopa por empresa e sem tabela devolve pronto:false', async () => {
  const c = controller(async (sql) => {
    if (/SELECT COUNT\(\*\) AS n FROM alertas_tecnicos/.test(sql)) return [[{ n: 2 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[]];
    if (/FROM alertas_tecnicos a/.test(sql)) return [[{ id: 1, titulo: 'x' }]];
  });
  let res = criarRes();
  await c.ctrl.avisarClientes(req({ params: { id: '1' }, body: { tipo: 'queda' } }), res);
  assert.strictEqual(res.statusCode, 400);
  const off = controller(async () => undefined, { instanciaConectada: async () => false });
  res = criarRes();
  await off.ctrl.avisarClientes(req({ params: { id: '1' }, body: { tipo: 'queda', confirmar: true } }), res);
  assert.strictEqual(res.statusCode, 409);
  res = criarRes();
  await c.ctrl.listar(req({ query: { estado: 'abertos', equipamento_id: '3' } }), res);
  assert.strictEqual(res.body.offline_agora, 2);
  const q = c.db.calls.find((x) => /FROM alertas_tecnicos a LEFT JOIN/.test(x.sql));
  assert.match(q.sql, /a\.empresa_id = \?/);
  assert.match(q.sql, /a\.resolvido_em IS NULL/);
  assert.deepStrictEqual(q.params, [7, 3]);
  const sem = controller(async () => { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; });
  res = criarRes();
  await sem.ctrl.listar(req({ query: {} }), res);
  assert.strictEqual(res.body.pronto, false);
  assert.match(res.body.aviso, /065/);
});
