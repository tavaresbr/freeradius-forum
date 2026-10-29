// Atendimento WhatsApp (automacao): horario, resposta automatica (anti-loop) e mensagens agendadas / lembretes.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const horario = require('../../src/utils/horarioAtendimento');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/utils/schemaCache.js', 'src/services/whatsappAutomacao.js', 'src/controllers/atendimentoAutomacaoController.js', 'src/jobs/processaAgendadas.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

// ---------- util puro ----------
test('horario: dentro/fora no fuso de Sao Paulo, fim de semana fechado, sem horario = sempre dentro', () => {
  const c = horario.mesclarComPadrao({ usar_horario: true });
  assert.strictEqual(horario.dentroDoHorario(c, new Date('2026-10-28T15:00:00Z')), true);  // quarta 12:00 BRT
  assert.strictEqual(horario.dentroDoHorario(c, new Date('2026-10-28T03:00:00Z')), false); // terca 00:00 BRT
  assert.strictEqual(horario.dentroDoHorario(c, new Date('2026-10-28T21:00:00Z')), false); // quarta 18:00 (fim exclusivo)
  assert.strictEqual(horario.dentroDoHorario(c, new Date('2026-10-31T15:00:00Z')), false); // sabado
  assert.strictEqual(horario.dentroDoHorario(horario.mesclarComPadrao({}), new Date('2026-10-31T15:00:00Z')), true);
});

test('validarAutomacao: recusa fuso/hora invalida, inicio >= fim, texto longo e ativo sem mensagem', () => {
  const ok = { ativo: true, msg_boas_vindas: 'Oi {{nome}}' };
  assert.strictEqual(horario.validarAutomacao(ok).ativo, true);
  assert.throws(() => horario.validarAutomacao({ ...ok, fuso: 'Marte/Olimpo' }), /Fuso/);
  const h = Array.from({ length: 7 }, () => ({ ativo: true, de: '18:00', ate: '08:00' }));
  assert.throws(() => horario.validarAutomacao({ ...ok, horarios: h }), /antes do fim/);
  const h2 = Array.from({ length: 7 }, () => ({ ativo: true, de: '8h', ate: '18:00' }));
  assert.throws(() => horario.validarAutomacao({ ...ok, horarios: h2 }), /HH:MM/);
  assert.throws(() => horario.validarAutomacao({ ...ok, msg_boas_vindas: 'x'.repeat(1001) }), /máximo/);
  assert.throws(() => horario.validarAutomacao({ ativo: true }), /ao menos uma mensagem/);
  assert.strictEqual(horario.validarAutomacao({ ativo: false }).ativo, false);
});

test('renderizar: primeiro nome (ou "cliente") e empresa', () => {
  assert.strictEqual(horario.renderizar('Oi {{nome}}, aqui e {{empresa}}', { nome: 'Maria Souza', empresa: 'Apex' }), 'Oi Maria, aqui e Apex');
  assert.strictEqual(horario.renderizar('Oi {{ nome }}', { nome: '' }), 'Oi cliente');
});

// ---------- resposta automatica ----------
const conv = { id: 5, jid: '5593999990000@s.whatsapp.net', telefone: '5593999990000', nome: 'Maria Souza' };
const montar = ({ cfg, claim = 1, anteriores = 0, saidas = 0, optout = false, colunas = true, recurso = true } = {}) => {
  const enviados = [];
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
    if (/FROM empresa_configs WHERE empresa_id = \? AND config_type = 'whatsapp'/.test(sql)) return [[{ config_json: JSON.stringify({ automacao: cfg }) }]];
    if (/direcao = 'in'/.test(sql)) return [[{ n: anteriores }]];
    if (/direcao = 'out'/.test(sql)) return [[{ n: saidas }]];
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[conv]];
    if (/FROM leads WHERE/.test(sql)) return [optout ? [{ id: 1 }] : []];
    if (/SELECT id, nome FROM leads|FROM information_schema/i.test(sql)) return [[]];
    if (/SET auto_resposta_em = NOW\(\)/.test(sql)) return [{ affectedRows: claim }];
    if (/FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
  });
  limpar();
  const svc = { enviarTexto: async (...a) => { enviados.push(a); } };
  const mod = carregar('src/services/whatsappAutomacao.js', {
    db,
    extras: {
      'src/services/whatsappAtendimento.js': svc,
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/utils/telefoneBusca.js': { exprTelefoneFim10: async () => 'RIGHT(telefone, 10)' },
    },
  });
  return { mod, db, enviados };
};
const cfgBase = { ativo: true, usar_horario: true, msg_boas_vindas: 'Oi {{nome}}!', msg_fora_horario: 'Fechado, {{nome}}.' };
const dentro = new Date('2026-10-28T15:00:00Z'), fora = new Date('2026-10-28T03:00:00Z');
const msgIn = (quando) => ({ fromMe: false, tipo: 'texto', texto: 'oi', quando });

test('auto: dentro do horario manda boas-vindas com o 1o nome, marcando como automatica', async () => {
  const { mod, enviados } = montar({ cfg: cfgBase });
  const r = await mod.responderAutomatico(7, 5, msgIn(dentro), dentro);
  assert.strictEqual(r.enviada, true);
  assert.strictEqual(enviados[0][3], 'Oi Maria!');
  assert.deepStrictEqual(enviados[0][4], { automatica: true });
});

test('auto: fora do horario manda a mensagem de fora do horario', async () => {
  const { mod, enviados } = montar({ cfg: cfgBase });
  const r = await mod.responderAutomatico(7, 5, msgIn(fora), fora);
  assert.strictEqual(r.enviada, true);
  assert.strictEqual(enviados[0][3], 'Fechado, Maria.');
});

test('auto: nao responde se desligado, sem recurso, sem migration, fromMe, "SAIR", opt-out', async () => {
  const casos = [
    [{ cfg: { ...cfgBase, ativo: false } }, msgIn(dentro), 'desligado'],
    [{ cfg: cfgBase, recurso: false }, msgIn(dentro), 'sem_recurso'],
    [{ cfg: cfgBase, colunas: false }, msgIn(dentro), 'sem_migration'],
    [{ cfg: cfgBase }, { ...msgIn(dentro), fromMe: true }, 'fromMe'],
    [{ cfg: cfgBase }, { ...msgIn(dentro), texto: ' Sair! ' }, 'sair'],
    [{ cfg: cfgBase, optout: true }, msgIn(dentro), 'optout'],
  ];
  for (const [opts, m, motivo] of casos) {
    const { mod, enviados } = montar(opts);
    const r = await mod.responderAutomatico(7, 5, m, dentro);
    assert.deepStrictEqual([r.enviada, r.motivo], [false, motivo]);
    assert.strictEqual(enviados.length, 0);
  }
});

test('auto: anti-loop — conversa em andamento, equipe ja respondeu e janela de 12 h ja usada', async () => {
  for (const [opts, motivo] of [[{ anteriores: 2 }, 'conversa_em_andamento'], [{ saidas: 1 }, 'ja_respondida'], [{ claim: 0 }, 'janela']]) {
    const { mod, enviados } = montar({ cfg: cfgBase, ...opts });
    const r = await mod.responderAutomatico(7, 5, msgIn(dentro), dentro);
    assert.deepStrictEqual([r.enviada, r.motivo], [false, motivo]);
    assert.strictEqual(enviados.length, 0);
  }
});

test('auto: a reserva da janela e as consultas sao sempre escopadas por empresa_id', async () => {
  const { mod, db } = montar({ cfg: cfgBase });
  await mod.responderAutomatico(7, 5, msgIn(dentro), dentro);
  const claim = db.calls.find((c) => /SET auto_resposta_em = NOW\(\)/.test(c.sql));
  assert.match(claim.sql, /empresa_id = \?/);
  assert.deepStrictEqual(claim.params, [5, 7]);
});

// ---------- controller ----------
const ctrlReq = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: { id: '5' }, body: {}, ...over });
const ctrl = (handler) => {
  limpar();
  const db = criarDb((sql, p) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT id FROM whatsapp_conversas WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[{ id: 5 }]] : [[]];
    return handler ? handler(sql, p) : undefined;
  });
  return { db, c: carregar('src/controllers/atendimentoAutomacaoController.js', { db }) };
};

test('agendar: valida futuro/limite, exige texto na mensagem, conversa da empresa e teto de pendentes', async () => {
  const restaurar = semLog();
  try {
    const { c, db } = ctrl((sql) => (/COUNT\(\*\)/.test(sql) ? [[{ n: 0 }]] : /INSERT INTO whatsapp_agendadas/.test(sql) ? [{ insertId: 9 }] : undefined));
    const futuro = new Date(Date.now() + 3600e3).toISOString();
    let res = criarRes();
    await c.criarAgendada(ctrlReq({ body: { tipo: 'mensagem', texto: 'Oi', enviar_em: futuro } }), res);
    assert.strictEqual(res.body.id, 9);
    const ins = db.calls.find((x) => /INSERT INTO whatsapp_agendadas/.test(x.sql));
    assert.strictEqual(ins.params[0], 7);

    for (const [body, re] of [
      [{ tipo: 'mensagem', texto: '', enviar_em: futuro }, /Digite/],
      [{ tipo: 'mensagem', texto: 'x', enviar_em: new Date(Date.now() - 1000).toISOString() }, /futuro/],
      [{ tipo: 'mensagem', texto: 'x', enviar_em: 'lixo' }, /inválida/],
      [{ tipo: 'mensagem', texto: 'x', enviar_em: new Date(Date.now() + 200 * 86400e3).toISOString() }, /90 dias/],
    ]) {
      res = criarRes();
      await c.criarAgendada(ctrlReq({ body }), res);
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.error, re);
    }
    // lembrete nao exige texto
    res = criarRes();
    await c.criarAgendada(ctrlReq({ body: { tipo: 'lembrete', enviar_em: futuro } }), res);
    assert.strictEqual(res.body.success, true);
    // conversa de outra empresa
    res = criarRes();
    await c.criarAgendada(ctrlReq({ empresa_id: 8, body: { tipo: 'lembrete', enviar_em: futuro } }), res);
    assert.strictEqual(res.statusCode, 404);
    // teto
    const cheio = ctrl((sql) => (/COUNT\(\*\)/.test(sql) ? [[{ n: 20 }]] : undefined));
    res = criarRes();
    await cheio.c.criarAgendada(ctrlReq({ body: { tipo: 'lembrete', enviar_em: futuro } }), res);
    assert.strictEqual(res.statusCode, 400);
  } finally { restaurar(); }
});

test('cancelar agendamento: escopado por empresa_id e so pendente/erro; outra empresa = 404', async () => {
  const { c, db } = ctrl(() => [{ affectedRows: 0 }]);
  const res = criarRes();
  await c.cancelarAgendada(ctrlReq({ params: { id: '4' } }), res);
  assert.strictEqual(res.statusCode, 404);
  const q = db.calls.find((x) => /UPDATE whatsapp_agendadas SET status = 'cancelada'/.test(x.sql));
  assert.match(q.sql, /empresa_id = \? AND status IN \('pendente','erro'\)/);
  assert.deepStrictEqual(q.params, [4, 7]);
});

test('automacao: salvar valida e persiste; ativar sem a migration 052 = 503', async () => {
  const body = { ativo: true, msg_boas_vindas: 'Oi' };
  let { c, db } = ctrl((sql) => (/FROM empresa_configs/.test(sql) ? [[{ id: 1, config_json: '{"api_key":"k"}' }]] : undefined));
  let res = criarRes();
  await c.salvarAutomacao(ctrlReq({ body }), res);
  assert.strictEqual(res.body.success, true);
  const up = db.calls.find((x) => /UPDATE empresa_configs SET config_json/.test(x.sql));
  const salvo = JSON.parse(up.params[0]);
  assert.strictEqual(salvo.api_key, 'k'); // preserva o resto da config
  assert.strictEqual(salvo.automacao.msg_boas_vindas, 'Oi');

  limpar();
  const db2 = criarDb((sql) => (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) ? [[{ n: 0 }]] : undefined));
  const c2 = carregar('src/controllers/atendimentoAutomacaoController.js', { db: db2 });
  res = criarRes();
  await c2.salvarAutomacao(ctrlReq({ body }), res);
  assert.strictEqual(res.statusCode, 503);
});

// ---------- job ----------
const rodarJob = async ({ pend, respondeu = 0, conectada = true, recurso = true }) => {
  limpar();
  const enviados = [];
  const db = criarDb((sql) => {
    if (/FROM whatsapp_agendadas\s+WHERE status = 'pendente'/.test(sql)) return [pend];
    if (/SET status = 'enviada', processado_em = NOW\(\) WHERE id = \? AND status = 'pendente'/.test(sql)) return [{ affectedRows: 1 }];
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[conv]];
    if (/direcao = 'in' AND criado_em >/.test(sql)) return [[{ n: respondeu }]];
  });
  const job = carregar('src/jobs/processaAgendadas.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada },
      'src/services/whatsappAtendimento.js': { enviarTexto: async (...a) => { enviados.push(a); } },
    },
  });
  await job();
  return { db, enviados };
};
const ag = (over) => ({ id: 1, empresa_id: 7, conversa_id: 5, tipo: 'mensagem', texto: 'Ola', enviar_em: new Date(), criado_em: new Date(Date.now() - 3600e3), admin_id: 3, ...over });

test('job: mensagem agendada e enviada pela conversa certa; WhatsApp desconectado devolve para a fila', async () => {
  let r = await rodarJob({ pend: [ag()] });
  assert.strictEqual(r.enviados.length, 1);
  assert.strictEqual(r.enviados[0][0], 7);
  assert.strictEqual(r.enviados[0][3], 'Ola');
  r = await rodarJob({ pend: [ag()], conectada: false });
  assert.strictEqual(r.enviados.length, 0);
  assert.ok(r.db.calls.some((c) => /SET status = 'pendente', processado_em = NULL/.test(c.sql)));
  r = await rodarJob({ pend: [ag()], recurso: false });
  assert.strictEqual(r.enviados.length, 0);
  assert.ok(r.db.calls.some((c) => /SET status = \?, erro = \?/.test(c.sql) && c.params[0] === 'erro'));
});

test('job: lembrete so vira nota se o cliente nao respondeu; se respondeu, cancela sem avisar', async () => {
  let r = await rodarJob({ pend: [ag({ tipo: 'lembrete', texto: 'ligar' })], respondeu: 0 });
  const nota = r.db.calls.find((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql));
  assert.ok(nota);
  assert.match(nota.params[3], /⏰ Lembrete.*\nligar/);
  assert.ok(r.db.calls.some((c) => /SET status = 'aberta', nao_lidas = nao_lidas \+ 1/.test(c.sql)));
  assert.strictEqual(r.enviados.length, 0);

  r = await rodarJob({ pend: [ag({ tipo: 'lembrete' })], respondeu: 2 });
  assert.ok(!r.db.calls.some((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql)));
  assert.ok(r.db.calls.some((c) => /SET status = \?, erro = \?/.test(c.sql) && c.params[0] === 'cancelada'));
});
