// Pos-compra e avaliacoes: validacao, job de agradecimento e gancho da nota de satisfacao.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar } = require('../helpers/mocks');
const pc = require('../../src/utils/posCompra');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/jobs/posCompra.js', 'src/services/whatsappPosCompra.js', 'src/services/whatsappAutomacao.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const base = { ativo: true, horas_apos: 2, msg_agradecimento: 'Oi {{nome}}, plano {{plano}} da {{empresa}}', link_avaliacao: 'https://g.page/r/abc', msg_avaliacao_alta: 'Avalie {{nome}}: {{link}}', alerta_nota_baixa: { ativo: true, telefones: ['93999990000'] } };

test('validarPosCompra: horas 1-72, link so https, telefone do alerta obrigatorio quando ativo', () => {
  const ok = pc.validarPosCompra(base);
  assert.strictEqual(ok.alerta_nota_baixa.telefones[0], '5593999990000');
  assert.throws(() => pc.validarPosCompra({ ...base, horas_apos: 0 }), /entre 1 e 72/);
  assert.throws(() => pc.validarPosCompra({ ...base, horas_apos: 73 }), /entre 1 e 72/);
  for (const l of ['http://x.com', 'javascript:alert(1)', 'https://u:p@x.com', 'ftp://x.com']) {
    assert.throws(() => pc.validarPosCompra({ ...base, link_avaliacao: l }), /https/);
  }
  assert.throws(() => pc.validarPosCompra({ ...base, msg_agradecimento: '' }), /agradecimento/);
  assert.throws(() => pc.validarPosCompra({ ...base, alerta_nota_baixa: { ativo: true, telefones: [] } }), /ao menos um telefone/);
  assert.throws(() => pc.validarPosCompra({ ...base, alerta_nota_baixa: { ativo: false, telefones: ['12'] } }), /Telefone inválido/);
  assert.strictEqual(pc.mesclarComPadrao(undefined).ativo, false);
  assert.strictEqual(pc.mascararTelefone('5593999991234'), '***1234');
});

// ---------- job ----------
const rodarJob = async ({ pos = base, pagamentos, lead = { id: 9, nome: 'Maria Silva', telefone: '93988887777', whatsapp_optout: 0 }, recurso = true, conectada = true, claimRepetido = false }) => {
  limpar();
  const enviados = [], logs = [];
  const db = criarDb((sql) => {
    if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify({ pos_compra: pos }) }]];
    if (/FROM pagamentos pg/.test(sql)) return [pagamentos];
    if (/FROM leads WHERE id = \?/.test(sql)) return [lead ? [lead] : []];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
    if (/INSERT IGNORE INTO whatsapp_pos_compra/.test(sql)) return [{ affectedRows: claimRepetido ? 0 : 1 }];
  });
  const job = carregar('src/jobs/posCompra.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
    },
  });
  await job({ dormir: async () => {} });
  return { db, enviados, logs };
};
const pag = (over = {}) => ({ id: 100, cliente_id: 9, cpf: null, telefone: null, nome_plano: 'Plano 1h', ...over });

test('job: agradece uma vez pelo telefone do lead, com variaveis e log pos_compra', async () => {
  const { enviados, logs, db } = await rodarJob({ pagamentos: [pag()] });
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0][0], '5593988887777');
  assert.strictEqual(enviados[0][1], 'Oi Maria, plano Plano 1h da Apex');
  assert.strictEqual(enviados[0][2], 7);
  assert.strictEqual(logs[0].contexto_tipo, 'pos_compra');
  const sel = db.calls.find((c) => /FROM pagamentos pg/.test(c.sql));
  assert.match(sel.sql, /pg\.empresa_id = \?/);
  assert.match(sel.sql, /pg\.status = 'approved'/);
  assert.deepStrictEqual(sel.params, [7, 2, 3]);
});

test('job: opt-out, sem telefone, desligado, sem recurso, desconectado e reserva repetida nao enviam', async () => {
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], lead: { id: 9, nome: 'X', telefone: '93988887777', whatsapp_optout: 1 } })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], lead: null })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], pos: { ...base, ativo: false } })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], recurso: false })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], conectada: false })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ pagamentos: [pag()], claimRepetido: true })).enviados.length, 0);
});

test('job: duas compras do mesmo numero na rodada = 1 mensagem; maximo 5 por rodada', async () => {
  assert.strictEqual((await rodarJob({ pagamentos: [pag({ id: 1 }), pag({ id: 2 })] })).enviados.length, 1);
  const muitos = Array.from({ length: 8 }, (_, i) => pag({ id: i + 1, cliente_id: null, telefone: `9398888${String(1000 + i)}` }));
  assert.strictEqual((await rodarJob({ pagamentos: muitos })).enviados.length, 5);
});

// ---------- gancho da nota ----------
const rodarNota = async ({ pos = base, nota, conectada = true, claimRepetido = false, enviarFalha = false }) => {
  limpar();
  const enviados = [], textos = [], logs = [];
  const db = criarDb((sql) => {
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ pos_compra: pos }) }]];
    if (/FROM whatsapp_conversas WHERE id/.test(sql)) return [[{ id: 5, empresa_id: 7, nome: 'Joao Souza', telefone: '5593988887777', nota_satisfacao: nota }]];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
    if (/INSERT IGNORE INTO whatsapp_pos_compra/.test(sql)) return [{ affectedRows: claimRepetido ? 0 : 1 }];
  });
  const svc = carregar('src/services/whatsappPosCompra.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => true },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
      'src/services/whatsappAtendimento.js': { enviarTexto: async (...a) => { if (enviarFalha) throw new Error('x'); textos.push(a); } },
    },
  });
  const r = await svc.aoReceberNota(7, 5, 55);
  return { r, enviados, textos, logs, db };
};

test('nota 4-5 manda o link de avaliacao na conversa (automatica); sem link ou repetida nao manda', async () => {
  let x = await rodarNota({ nota: 5 });
  assert.strictEqual(x.textos.length, 1);
  assert.strictEqual(x.textos[0][3], 'Avalie Joao: https://g.page/r/abc');
  assert.deepStrictEqual(x.textos[0][4], { automatica: true });
  assert.strictEqual((await rodarNota({ nota: 4, pos: { ...base, link_avaliacao: '' } })).textos.length, 0);
  assert.strictEqual((await rodarNota({ nota: 5, claimRepetido: true })).textos.length, 0);
  x = await rodarNota({ nota: 5, enviarFalha: true });
  assert.ok(x.db.calls.some((c) => /DELETE FROM whatsapp_pos_compra/.test(c.sql))); // devolve a reserva
});

test('nota 1-2 alerta o gestor sem expor o telefone inteiro; nota 3 nao faz nada; desligado nao faz nada', async () => {
  const x = await rodarNota({ nota: 1 });
  assert.strictEqual(x.enviados.length, 1);
  assert.match(x.enviados[0][1], /Nota 1\/5.*Joao Souza \(\*\*\*7777\)/);
  assert.ok(!x.enviados[0][1].includes('93988887777'));
  assert.strictEqual(x.logs[0].contexto_tipo, 'alerta_nota_baixa');
  assert.strictEqual((await rodarNota({ nota: 3 })).enviados.length, 0);
  assert.strictEqual((await rodarNota({ nota: 1, pos: { ...base, ativo: false } })).enviados.length, 0);
  assert.strictEqual((await rodarNota({ nota: 2, conectada: false })).enviados.length, 0);
});
