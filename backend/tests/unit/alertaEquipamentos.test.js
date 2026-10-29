// Alerta de equipamento offline: validacao, maquina de estados, job e controller.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const al = require('../../src/utils/alertaEquipamentos');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/jobs/alertaEquipamentos.js', 'src/controllers/alertaEquipamentosController.js', 'src/services/whatsappAutomacao.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

test('validarAlerta: telefones validos (ate 3, sem repetidos), falhas 2-10 e telefone obrigatorio quando ativo', () => {
  const ok = al.validarAlerta({ ativo: true, telefones: ['(93) 99999-0000', '93999990000'], falhas: 3, avisar_volta: false });
  assert.deepStrictEqual(ok.telefones.length, 1);
  assert.strictEqual(ok.avisar_volta, false);
  assert.throws(() => al.validarAlerta({ ativo: true, telefones: [], falhas: 3 }), /ao menos um telefone/);
  assert.throws(() => al.validarAlerta({ ativo: false, telefones: ['123'], falhas: 3 }), /Telefone inválido/);
  assert.throws(() => al.validarAlerta({ ativo: false, telefones: ['93999990001', '93999990002', '93999990003', '93999990004'], falhas: 3 }), /Máximo/);
  assert.throws(() => al.validarAlerta({ ativo: false, telefones: [], falhas: 1 }), /entre 2 e 10/);
  assert.throws(() => al.validarAlerta({ ativo: false, telefones: [], falhas: 11 }), /entre 2 e 10/);
  assert.strictEqual(al.mesclarComPadrao(undefined).ativo, false);
});

test('proximoEstado: avisa so apos N falhas seguidas, 1 vez por queda, e avisa a volta', () => {
  const cfg = { falhas: 3, avisar_volta: true };
  const t0 = new Date('2026-10-29T12:00:00Z');
  let e = null;
  let r = al.proximoEstado(e, true, t0, cfg);
  assert.strictEqual(r.acao, null); // primeira vez online: nada
  e = r.estado;
  r = al.proximoEstado(e, false, t0, cfg); assert.strictEqual(r.acao, null); e = r.estado;
  r = al.proximoEstado(e, false, new Date(t0.getTime() + 300000), cfg); assert.strictEqual(r.acao, null); e = r.estado;
  r = al.proximoEstado(e, false, new Date(t0.getTime() + 600000), cfg);
  assert.strictEqual(r.acao, 'offline'); // 3a falha seguida
  assert.strictEqual(r.estado.alertado, true); e = r.estado;
  r = al.proximoEstado(e, false, new Date(t0.getTime() + 900000), cfg);
  assert.strictEqual(r.acao, null); // nao repete o aviso da mesma queda
  e = r.estado;
  r = al.proximoEstado(e, true, new Date(t0.getTime() + 1200000), cfg);
  assert.strictEqual(r.acao, 'voltou');
  assert.strictEqual(r.fora_min, 20);
  assert.deepStrictEqual([r.estado.online, r.estado.falhas, r.estado.alertado], [true, 0, false]);
});

test('proximoEstado: falha isolada seguida de sucesso nao avisa; sem avisar_volta nao manda "voltou"', () => {
  const cfg = { falhas: 3, avisar_volta: true };
  const t = new Date();
  let r = al.proximoEstado(null, false, t, cfg);
  r = al.proximoEstado(r.estado, true, t, cfg);
  assert.strictEqual(r.acao, null);
  assert.strictEqual(r.estado.falhas, 0);
  let e = { online: false, falhas: 5, alertado: true, falha_desde: t };
  assert.strictEqual(al.proximoEstado(e, true, t, { falhas: 3, avisar_volta: false }).acao, null);
});

// ---------- job ----------
const eq = { id: 3, empresa_id: 7, nome: 'Roteador Centro', ip: '10.0.0.1', tipo: 'mikrotik' };
const rodar = async ({ cfg, estado = null, testarOk = true, recurso = true, conectada = true, agora = new Date('2026-10-29T15:00:00Z') }) => {
  limpar();
  const enviados = [];
  const logs = [];
  const db = criarDb((sql) => {
    if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify({ alerta_equipamentos: cfg }) }]];
    if (/FROM mikrotiks WHERE empresa_id/.test(sql)) return [[eq]];
    if (/FROM equipamento_status WHERE empresa_id/.test(sql)) return [estado ? [{ mikrotik_id: 3, ...estado }] : []];
  });
  const job = carregar('src/jobs/alertaEquipamentos.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
    },
  });
  await job({ dormir: async () => {}, testar: async () => (testarOk ? { sucesso: true } : { sucesso: false, erro: 'sem resposta' }), agora });
  return { db, enviados, logs };
};
const cfgOn = { ativo: true, telefones: ['5593999990000', '5593999990001'], falhas: 3, avisar_volta: true };
const gravacao = (db) => db.calls.find((c) => /INSERT INTO equipamento_status/.test(c.sql));

test('job: 3a falha seguida avisa TODOS os telefones uma vez e grava o estado escopado por empresa', async () => {
  const { enviados, db, logs } = await rodar({ cfg: cfgOn, testarOk: false, estado: { online: 1, falhas: 2, alertado: 0, falha_desde: new Date('2026-10-29T14:50:00Z') } });
  assert.strictEqual(enviados.length, 2);
  assert.deepStrictEqual(enviados.map((e) => e[0]), cfgOn.telefones);
  assert.match(enviados[0][1], /OFFLINE: Roteador Centro \(10\.0\.0\.1\)/);
  assert.strictEqual(enviados[0][2], 7);
  assert.strictEqual(logs[0].contexto_tipo, 'alerta_equipamento');
  const g = gravacao(db);
  assert.strictEqual(g.params[1], 7);
  assert.strictEqual(g.params[5], 1); // alertado
});

test('job: ainda offline (ja alertado) nao repete; volta avisa uma vez; antes do limite nao avisa', async () => {
  let r = await rodar({ cfg: cfgOn, testarOk: false, estado: { online: 0, falhas: 4, alertado: 1, falha_desde: new Date() } });
  assert.strictEqual(r.enviados.length, 0);
  r = await rodar({ cfg: cfgOn, testarOk: true, estado: { online: 0, falhas: 4, alertado: 1, falha_desde: new Date('2026-10-29T14:40:00Z') } });
  assert.strictEqual(r.enviados.length, 2);
  assert.match(r.enviados[0][1], /de volta: Roteador Centro/);
  assert.match(r.enviados[0][1], /20 min/);
  r = await rodar({ cfg: cfgOn, testarOk: false, estado: { online: 1, falhas: 0, alertado: 0, falha_desde: null } });
  assert.strictEqual(r.enviados.length, 0);
});

test('job: desligado, sem recurso, sem telefone ou WhatsApp desconectado nao avisam (desconectado tenta de novo depois)', async () => {
  const falha = { online: 1, falhas: 2, alertado: 0, falha_desde: new Date() };
  for (const caso of [{ cfg: { ...cfgOn, ativo: false } }, { cfg: { ...cfgOn, telefones: [] } }, { cfg: cfgOn, recurso: false }]) {
    assert.strictEqual((await rodar({ ...caso, testarOk: false, estado: falha })).enviados.length, 0);
  }
  const r = await rodar({ cfg: cfgOn, conectada: false, testarOk: false, estado: falha });
  assert.strictEqual(r.enviados.length, 0);
  assert.strictEqual(gravacao(r.db).params[5], 0); // nao marcou como alertado: a proxima rodada avisa
});

test('job: testar() trata excecao, {sucesso:false} e tempo esgotado como offline', async () => {
  limpar();
  const mod = carregar('src/jobs/alertaEquipamentos.js', { db: criarDb(), extras: { 'src/utils/assinatura.js': { temRecurso: async () => true }, 'src/controllers/whatsappController.js': {} } });
  assert.deepStrictEqual(await mod.testar({}, async () => ({ sucesso: true })), { ok: true });
  assert.strictEqual((await mod.testar({}, async () => { throw new Error('ECONNREFUSED'); })).ok, false);
  assert.strictEqual((await mod.testar({}, async () => ({ sucesso: false, erro: 'x' }))).erro, 'x');
});

// ---------- controller ----------
const ctrlReq = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, body: {}, ...over });

test('controller: salvar valida e preserva o resto da config; teste manda [TESTE]; obter sem a tabela segue com a config', async () => {
  limpar();
  const enviados = [];
  const db = criarDb((sql) => {
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: '{"api_key":"k","automacao":{"ativo":true}}' }]];
    if (/SELECT id FROM empresa_configs/.test(sql)) return [[{ id: 1 }]];
  });
  const c = carregar('src/controllers/alertaEquipamentosController.js', { db, extras: { 'src/controllers/whatsappController.js': { enviarMensagemEstrita: async (...a) => { enviados.push(a); } } } });
  let res = criarRes();
  await c.salvar(ctrlReq({ body: { ativo: true, telefones: ['93999990000'], falhas: 3 } }), res);
  assert.strictEqual(res.body.success, true);
  const salvo = JSON.parse(db.calls.find((x) => /UPDATE empresa_configs SET config_json/.test(x.sql)).params[0]);
  assert.strictEqual(salvo.api_key, 'k');
  assert.strictEqual(salvo.automacao.ativo, true);
  assert.strictEqual(salvo.alerta_equipamentos.telefones.length, 1);

  res = criarRes();
  await c.salvar(ctrlReq({ body: { ativo: true, telefones: [], falhas: 3 } }), res);
  assert.strictEqual(res.statusCode, 400);

  res = criarRes();
  await c.testar(ctrlReq({ body: { telefone: '(93) 99999-0000' } }), res);
  assert.strictEqual(res.body.success, true);
  assert.match(enviados[0][1], /^\[TESTE\] ⚠️ Equipamento OFFLINE/);
  res = criarRes();
  await c.testar(ctrlReq({ body: { telefone: '1' } }), res);
  assert.strictEqual(res.statusCode, 400);

  limpar();
  const db2 = criarDb((sql) => {
    if (/equipamento_status/.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: '{}' }]];
    if (/FROM mikrotiks/.test(sql)) return [[{ id: 3, nome: 'R1', ip: '1.1.1.1' }]];
  });
  const c2 = carregar('src/controllers/alertaEquipamentosController.js', { db: db2, extras: { 'src/controllers/whatsappController.js': {} } });
  res = criarRes();
  const restaurar = semLog();
  try { await c2.obter(ctrlReq(), res); } finally { restaurar(); }
  assert.strictEqual(res.body.equipamentos.length, 1);
  assert.strictEqual(res.body.alerta.ativo, false);
});
