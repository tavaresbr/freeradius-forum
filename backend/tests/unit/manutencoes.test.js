// Manutencoes programadas: validacao, etapas, publico, controller, job de avisos e supressao do alerta offline.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const mu = require('../../src/utils/manutencao');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };
const base = { titulo: 'Troca de fibra', mensagem: 'Oi {{nome}}, manutenção em {{equipamento}} de {{inicio}} até {{fim}}', inicio_em: '2026-11-02T22:00', fim_em: '2026-11-03T02:00', antecedencias: [1440, 60], aviso_fim: true };

test('validarManutencao: datas, duracao, antecedencias, mensagem e equipamento', () => {
  const ok = mu.validarManutencao(base);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.valor.inicio_em, '2026-11-02 22:00:00');
  assert.deepStrictEqual(ok.valor.antecedencias, [1440, 60]);
  const erro = (o) => mu.validarManutencao({ ...base, ...o }).erro;
  assert.match(erro({ titulo: ' ' }), /título/);
  assert.match(erro({ mensagem: '' }), /mensagem/);
  assert.match(erro({ fim_em: '2026-11-02T21:00' }), /depois do início/);
  assert.match(erro({ fim_em: '2026-11-20T21:00' }), /7 dias/);
  assert.match(erro({ inicio_em: '2026-02-31T10:00' }), /válidos/);
  assert.match(erro({ antecedencias: [7] }), /Antecedência/);
  assert.match(erro({ antecedencias: [15, 30, 60, 180] }), /no máximo 3/);
  assert.match(erro({ equipamento_id: 'x' }), /Equipamento/);
  assert.match(erro({ janela_dias: 0 }), /Janela/);
  assert.strictEqual(mu.validarManutencao({ ...base, avisar_clientes: false, mensagem: '' }).ok, true, 'sem avisar clientes a mensagem e opcional');
});

test('renderizarMensagem troca inicio/fim/equipamento e deixa {{nome}} para o worker', () => {
  const t = mu.renderizarMensagem(base.mensagem, { inicio: '2026-11-02 22:00:00', fim: '2026-11-03 02:00:00', equipamento: 'Praça' });
  assert.strictEqual(t, 'Oi {{nome}}, manutenção em Praça de 02/11 22:00 até 03/11 02:00');
});

test('etapasDevidas: so a mais proxima antes do inicio, sem repetir; aviso final apos o fim; sem avisar_clientes nada', () => {
  const m = { antecedencias: [1440, 60], aviso_fim: true, avisar_clientes: 1 };
  assert.deepStrictEqual(mu.etapasDevidas(m, 1000, 1240, []), ['a1440']);
  assert.deepStrictEqual(mu.etapasDevidas(m, 1000, 1240, ['a1440']), []);
  assert.deepStrictEqual(mu.etapasDevidas(m, 50, 290, ['a1440']), ['a60']);
  assert.deepStrictEqual(mu.etapasDevidas(m, 50, 290, []), ['a60', 'pula:a1440'], 'criada em cima da hora: manda 1 e marca o outro como vencido');
  assert.deepStrictEqual(mu.etapasDevidas(m, -30, -10, ['a60']), ['fim']);
  assert.deepStrictEqual(mu.etapasDevidas(m, -30, -10, ['a60', 'fim']), []);
  assert.deepStrictEqual(mu.etapasDevidas(m, -30, -400, []), [], 'fim muito antigo nao avisa');
  assert.deepStrictEqual(mu.etapasDevidas({ ...m, avisar_clientes: 0 }, 50, 290, []), []);
});

test('publico: escopa por empresa/equipamento, usa janela e tira bloqueados, repetidos e telefone invalido', async () => {
  limpar();
  const db = criarDb(async (sql, params) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM whatsapp_nao_perturbe/.test(sql)) return [[{ telefone_fim10: '3977776666' }]];
    if (/FROM leads WHERE empresa_id = \? AND whatsapp_optout = 1/.test(sql)) return [[]];
    if (/FROM leads l/.test(sql)) return [[
      { id: 1, nome: 'Ana', telefone: '93988887777' }, { id: 2, nome: 'Bia', telefone: '93977776666' },
      { id: 3, nome: 'Ana2', telefone: '(93) 98888-7777' }, { id: 4, nome: 'X', telefone: '12' },
    ]];
  });
  const pub = carregar('src/utils/manutencaoPublico.js', { db });
  const r = await pub.selecionarPublico(db, 7, 3, 15);
  assert.deepStrictEqual(r.destinatarios.map((d) => d.lead_id), [1]);
  assert.deepStrictEqual([r.invalidos, r.bloqueados, r.duplicados], [1, 1, 1]);
  const q = db.calls.find((c) => /FROM leads l/.test(c.sql));
  assert.match(q.sql, /l\.empresa_id = \?/);
  assert.match(q.sql, /m\.id = \? AND m\.empresa_id = \?/);
  assert.deepStrictEqual(q.params, [7, 7, 15, 3, 7]);
  await pub.selecionarPublico(db, 7, null, 30);
  const q2 = db.calls.filter((c) => /FROM leads l/.test(c.sql)).pop();
  assert.match(q2.sql, /m\.empresa_id = \?\)/);
  assert.deepStrictEqual(q2.params, [7, 7, 30, 7]);
});

function controller(handler) {
  limpar();
  const db = criarDb(handler);
  return { db, ctrl: carregar('src/controllers/manutencoesController.js', { db }) };
}
const req = (o) => criarReq({ empresa_id: 7, user: { id: 2 }, ...o });

test('controller: criar valida, exige equipamento da empresa e inicio no futuro; grava com empresa do token', async () => {
  const { db, ctrl } = controller(async (sql) => {
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[]]; // equipamento de outra empresa
    if (/TIMESTAMPDIFF/.test(sql)) return [[{ min: -5 }]];
    if (/^INSERT INTO manutencoes/.test(sql)) return [{ insertId: 9 }];
  });
  let res = criarRes();
  await ctrl.criar(req({ body: { ...base, equipamento_id: 99 } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Equipamento/);
  const ok = controller(async (sql) => {
    if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ id: 3 }]];
    if (/TIMESTAMPDIFF/.test(sql)) return [[{ min: 100 }]];
    if (/^INSERT INTO manutencoes/.test(sql)) return [{ insertId: 9 }];
  });
  res = criarRes();
  await ok.ctrl.criar(req({ body: { ...base, equipamento_id: 3, empresa_id: 999 } }), res);
  assert.strictEqual(res.statusCode, 201);
  const ins = ok.db.calls.find((c) => /^INSERT INTO manutencoes/.test(c.sql));
  assert.ok(ins.params.includes(7) && !ins.params.includes(999), 'empresa vem so do token');
  const passado = controller(async (sql) => (/TIMESTAMPDIFF/.test(sql) ? [[{ min: -1 }]] : undefined));
  res = criarRes();
  await passado.ctrl.criar(req({ body: base }), res);
  assert.match(res.body.error, /futuro/);
  void db;
});

test('controller: editar so agendada sem avisos enviados (409); cancelar encerra e cancela a fila pendente; sem tabela = 503', async () => {
  const c = controller(async (sql) => {
    if (/TIMESTAMPDIFF/.test(sql)) return [[{ min: 100 }]];
    if (/^UPDATE manutencoes SET titulo/.test(sql)) return [{ affectedRows: 0 }];
    if (/^UPDATE manutencoes SET status = 'cancelada'/.test(sql)) return [{ affectedRows: 1 }];
  });
  let res = criarRes();
  await c.ctrl.atualizar(req({ params: { id: '4' }, body: base }), res);
  assert.strictEqual(res.statusCode, 409);
  res = criarRes();
  await c.ctrl.cancelar(req({ params: { id: '4' } }), res);
  assert.strictEqual(res.body.success, true);
  const fila = c.db.calls.find((x) => /^UPDATE promocao_envios SET status = 'cancelada'/.test(x.sql));
  assert.match(fila.sql, /empresa_id = \?/);
  assert.deepStrictEqual(fila.params, [7, 4]);
  const upd = c.db.calls.find((x) => /^UPDATE manutencoes SET status = 'cancelada'/.test(x.sql));
  assert.deepStrictEqual(upd.params, [4, 7]);
  const sem = controller(async () => { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; });
  res = criarRes();
  await sem.ctrl.listar(req({ query: {} }), res);
  assert.strictEqual(res.body.pronto, false);
  res = criarRes();
  await sem.ctrl.criar(req({ body: base }), res);
  assert.strictEqual(res.statusCode, 503);
});

// ---------- job ----------
async function rodarJob({ mt = {}, feitas = [], claim = 1, publico = [{ lead_id: 1, nome: 'Ana', telefone: '5593988887777' }], recurso = true, silencio = false } = {}) {
  limpar();
  const registro = { logs: [] };
  const mtRow = { id: 5, empresa_id: 7, titulo: 'Troca', mensagem: 'Oi {{nome}} {{equipamento}} {{inicio}}', mensagem_fim: null, equipamento_id: 3, equipamento_nome: 'Praça',
    inicio_em: '2026-11-02 22:00:00', fim_em: '2026-11-03 02:00:00', antecedencias: '[1440,60]', aviso_fim: 1, avisar_clientes: 1, janela_dias: 30, min_ate_inicio: 1000, min_ate_fim: 1240, ...mt };
  const db = criarDb(async (sql) => {
    if (/FROM manutencoes mt/.test(sql)) return [[mtRow]];
    if (/SELECT etapa FROM manutencao_avisos/.test(sql)) return [feitas.map((etapa) => ({ etapa }))];
    if (/^INSERT IGNORE INTO manutencao_avisos/.test(sql)) return [{ affectedRows: claim }];
    if (/^INSERT INTO promocao_envios/.test(sql)) return [{ insertId: 77 }];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [silencio ? [{ config_json: JSON.stringify({ nao_perturbe: { ativo: true, fuso: 'UTC', de: '00:00', ate: '23:59', dias: [0, 1, 2, 3, 4, 5, 6], aplicar_a: ['manutencao'] } }) }] : []];
  });
  const job = carregar('src/jobs/manutencoes.js', { db, extras: {
    'src/utils/assinatura.js': { temRecurso: async () => recurso },
    'src/utils/manutencaoPublico.js': { selecionarPublico: async () => ({ destinatarios: publico }) },
  } });
  await job();
  registro.db = db;
  return registro;
}

test('job: etapa devida cria 1 envio de aviso em andamento com a mensagem renderizada e os destinatarios da empresa', async () => {
  const { db } = await rodarJob();
  const env = db.calls.find((c) => /^INSERT INTO promocao_envios/.test(c.sql));
  assert.strictEqual(env.params[0], 7);
  assert.match(env.sql, /'aviso'.*'em_andamento'/);
  assert.strictEqual(env.params[2], 'Oi {{nome}} Praça 02/11 22:00');
  assert.deepStrictEqual(JSON.parse(env.params[3]), { origem: 'manutencao', manutencao_id: 5, etapa: 'a1440' });
  const dest = db.calls.find((c) => /^INSERT INTO promocao_destinatarios/.test(c.sql));
  assert.deepStrictEqual(dest.params[0][0], [77, 7, 1, '5593988887777', 'Ana']);
  assert.ok(db.calls.some((c) => /^UPDATE manutencao_avisos SET envio_id/.test(c.sql)));
});

test('job: etapa ja reservada, sem recurso whatsapp, no silencio ou sem publico nao cria envio; silencio nao reserva', async () => {
  for (const o of [{ claim: 0 }, { feitas: ['a1440'] }, { recurso: false }, { silencio: true }, { publico: [] }]) {
    const { db } = await rodarJob(o);
    assert.ok(!db.calls.some((c) => /^INSERT INTO promocao_envios/.test(c.sql)), JSON.stringify(o));
  }
  const { db } = await rodarJob({ silencio: true });
  assert.ok(!db.calls.some((c) => /^INSERT IGNORE INTO manutencao_avisos/.test(c.sql)), 'adiada: nada reservado');
});

test('job: aviso final apos o fim usa a mensagem de fim (ou a padrao)', async () => {
  const { db } = await rodarJob({ mt: { min_ate_inicio: -300, min_ate_fim: -5 }, feitas: ['a1440', 'a60'] });
  const env = db.calls.find((c) => /^INSERT INTO promocao_envios/.test(c.sql));
  assert.match(env.params[2], /manutenção terminou/);
  assert.strictEqual(JSON.parse(env.params[3]).etapa, 'fim');
});

test('worker: aviso de manutencao respeita o silencio; aviso operacional comum nao', async () => {
  limpar();
  const enviados = [];
  const montar = (origem) => {
    const db = criarDb(async (sql) => {
      if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
      if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ nao_perturbe: { ativo: true, fuso: 'UTC', de: '00:00', ate: '23:59', dias: [0, 1, 2, 3, 4, 5, 6], aplicar_a: ['manutencao'] } }) }]];
      if (/FROM promocao_envios WHERE status = 'em_andamento'/.test(sql)) return [[{ id: 1, empresa_id: 7, mensagem: 'Oi', tipo: 'aviso', filtros_json: JSON.stringify(origem ? { origem } : {}) }]];
      if (/FROM promocao_destinatarios\s+WHERE envio_id/.test(sql)) return [[{ id: 1, lead_id: null, telefone: '5511988887777', nome: 'X' }]];
      if (/^SELECT status FROM promocao_envios/.test(sql)) return [[{ status: 'em_andamento' }]];
      if (/GROUP BY status/.test(sql)) return [[]];
    });
    return carregar('src/jobs/enviaPromocoes.js', { db, extras: { 'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async (t) => { enviados.push(t); } } } });
  };
  await montar('manutencao')({ dormir: async () => {} });
  assert.strictEqual(enviados.length, 0);
  limpar();
  await montar(null)({ dormir: async () => {} });
  assert.strictEqual(enviados.length, 1);
});

test('alerta offline: equipamento em manutencao programada nao avisa a equipe e o aviso fica pendente para depois', async () => {
  const rodar = async (emManutencao) => {
    limpar();
    const enviados = [];
    const db = criarDb(async (sql) => {
      if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify({ alerta_equipamentos: { ativo: true, telefones: ['5593999990000'], falhas: 3, avisar_volta: true } }) }]];
      if (/FROM mikrotiks WHERE empresa_id/.test(sql)) return [[{ id: 3, empresa_id: 7, nome: 'Centro', ip: '10.0.0.1', tipo: 'mikrotik' }]];
      if (/FROM equipamento_status WHERE empresa_id/.test(sql)) return [[{ mikrotik_id: 3, online: 1, falhas: 2, alertado: 0, falha_desde: new Date('2026-10-29T14:50:00Z') }]];
      if (/FROM manutencoes WHERE empresa_id/.test(sql)) return [emManutencao ? [{ equipamento_id: 3 }] : []];
    });
    const job = carregar('src/jobs/alertaEquipamentos.js', { db, extras: {
      'src/utils/assinatura.js': { temRecurso: async () => true },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async () => {} },
    } });
    await job({ dormir: async () => {}, testar: async () => ({ sucesso: false, erro: 'x' }), agora: new Date('2026-10-29T15:00:00Z') });
    return { enviados, db };
  };
  assert.strictEqual((await rodar(false)).enviados.length, 1);
  const r = await rodar(true);
  assert.strictEqual(r.enviados.length, 0);
  const g = r.db.calls.find((c) => /INSERT INTO equipamento_status/.test(c.sql));
  assert.strictEqual(g.params[5], 0, 'continua nao alertado: avisa depois da manutencao se seguir fora');
});
