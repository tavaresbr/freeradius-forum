// Renovacao por WhatsApp: validacao, job de lembretes e relatorio.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const rn = require('../../src/utils/renovacao');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/jobs/renovacaoWhatsapp.js', 'src/controllers/atendimentoAutomacaoController.js', 'src/services/whatsappAutomacao.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const base = { ativo: true, dias: [0, 3, 7], template: 'Oi {{nome}}, {{plano}} da {{empresa}} acabou: {{link}}', cupom: 'VOLTA10' };

test('validarRenovacao: dias permitidos (max 3), link obrigatorio na mensagem, cupom opcional valido', () => {
  const ok = rn.validarRenovacao({ ...base, dias: [7, 0, 3, 3], cupom: ' volta10 ' });
  assert.deepStrictEqual(ok.dias, [0, 3, 7]);
  assert.strictEqual(ok.cupom, 'VOLTA10');
  assert.throws(() => rn.validarRenovacao({ ...base, dias: [0, 1, 2, 3] }), /no máximo 3/);
  assert.throws(() => rn.validarRenovacao({ ...base, dias: [4] }), /Dias inválidos/);
  assert.throws(() => rn.validarRenovacao({ ...base, dias: [] }), /ao menos um dia/);
  assert.throws(() => rn.validarRenovacao({ ...base, template: 'sem o link aqui' }), /\{\{link\}\}/);
  assert.throws(() => rn.validarRenovacao({ ...base, cupom: 'a b' }), /Cupom/);
  assert.strictEqual(rn.validarRenovacao({ ativo: false, dias: [], template: '', cupom: '' }).ativo, false);
  assert.strictEqual(rn.mesclarComPadrao(undefined).ativo, false);
});

test('comCupom: acrescenta ?cupom= so com cupom valido', () => {
  assert.strictEqual(rn.comCupom('https://x.com/planos-cliente?a=1', 'VOLTA10'), 'https://x.com/planos-cliente?a=1&cupom=VOLTA10');
  assert.strictEqual(rn.comCupom('https://x.com/p', 'VOLTA10'), 'https://x.com/p?cupom=VOLTA10');
  assert.strictEqual(rn.comCupom('https://x.com/p', ''), 'https://x.com/p');
  assert.strictEqual(rn.comCupom('https://x.com/p', 'a&b=1'), 'https://x.com/p');
  assert.strictEqual(rn.comCupom('', 'VOLTA10'), '');
});

// ---------- job ----------
const pag = (over = {}) => ({ id: 100, cliente_id: 9, cpf: null, telefone: null, nome_plano: 'Plano 1h', nas_id: 3, ...over });
async function rodarJob({ ren = base, candidatos = [pag()], lead = { id: 9, nome: 'Maria Silva', telefone: '93988887777', whatsapp_optout: 0 }, recurso = true, conectada = true, claimRepetido = false, recente = false }) {
  limpar();
  const enviados = [], logs = [];
  const db = criarDb(async (sql) => {
    if (/FROM empresa_configs WHERE config_type = 'whatsapp'/.test(sql)) return [[{ empresa_id: 7, config_json: JSON.stringify({ renovacao: ren }) }]];
    if (/FROM pagamentos pg/.test(sql)) return [candidatos];
    if (/FROM leads WHERE id = \?/.test(sql)) return [lead ? [lead] : []];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
    if (/SELECT id FROM whatsapp_cobrancas WHERE empresa_id = \? AND telefone/.test(sql)) return [recente ? [{ id: 1 }] : []];
    if (/INSERT IGNORE INTO whatsapp_cobrancas/.test(sql)) return [{ affectedRows: claimRepetido ? 0 : 1 }];
  });
  const job = carregar('src/jobs/renovacaoWhatsapp.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
      'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
      'src/utils/linkPlanos.js': { linkPlanosDoCliente: async (emp, o) => `https://portal.x.com/planos-cliente?empresa_id=${emp}&mikrotik_id=${o.nasId}&cliente_id=${o.clienteId}` },
    },
  });
  await job({ dormir: async () => {} });
  return { db, enviados, logs };
}

test('job: lembra a ultima compra vencida pelo telefone do cadastro, com link e cupom; consulta escopada e sem historico antigo', async () => {
  const { enviados, logs, db } = await rodarJob({ ren: { ...base, dias: [3] } });
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0][0], '5593988887777');
  assert.strictEqual(enviados[0][1], 'Oi Maria, Plano 1h da Apex acabou: https://portal.x.com/planos-cliente?empresa_id=7&mikrotik_id=3&cliente_id=9&cupom=VOLTA10');
  assert.strictEqual(enviados[0][2], 7);
  assert.strictEqual(logs[0].contexto_tipo, 'renovacao');
  const sel = db.calls.find((c) => /FROM pagamentos pg/.test(c.sql));
  assert.match(sel.sql, /pg\.empresa_id = \?/);
  assert.match(sel.sql, /pg2\.id > pg\.id/, 'so a ultima compra do cliente');
  assert.deepStrictEqual(sel.params, [7, 3, 5, 3], 'janela de 2 dias a partir de D');
});

test('job: opt-out, sem telefone, desligado, sem recurso, desconectado, reserva repetida e telefone avisado ha menos de 20 h nao enviam', async () => {
  assert.strictEqual((await rodarJob({ lead: { id: 9, nome: 'X', telefone: '93988887777', whatsapp_optout: 1 } })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ lead: null })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ ren: { ...base, ativo: false } })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ recurso: false })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ conectada: false })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ claimRepetido: true })).enviados.length, 0);
  assert.strictEqual((await rodarJob({ recente: true })).enviados.length, 0);
});

test('job: no maximo 5 por rodada e 1 mensagem por telefone na rodada', async () => {
  const muitos = Array.from({ length: 9 }, (_, i) => pag({ id: i + 1, cliente_id: null, telefone: `9398888${String(1000 + i)}` }));
  assert.strictEqual((await rodarJob({ candidatos: muitos, ren: { ...base, dias: [0] } })).enviados.length, 5);
  assert.strictEqual((await rodarJob({ candidatos: [pag({ id: 1 }), pag({ id: 2 })], ren: { ...base, dias: [0] } })).enviados.length, 1);
});

// ---------- controller ----------
test('controller: salvar valida, preserva a config e avisa se falta a migration; relatorio soma envios e conversoes', async () => {
  limpar();
  let semTabela = false;
  const db = criarDb(async (sql) => {
    if (/SELECT 1 FROM whatsapp_cobrancas/.test(sql)) { if (semTabela) { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } return [[{}]]; }
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ chatbot: { ativo: false } }) }]];
    if (/FROM whatsapp_cobrancas c/.test(sql)) return [[{ etapa: 0, enviadas: 10, convertidas: 3 }, { etapa: 3, enviadas: 5, convertidas: '1' }]];
  });
  const ctrl = carregar('src/controllers/atendimentoAutomacaoController.js', { db });
  let res = criarRes();
  await ctrl.salvarRenovacao(criarReq({ empresa_id: 7, body: base }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.renovacao.dias, [0, 3, 7]);
  res = criarRes();
  await ctrl.salvarRenovacao(criarReq({ empresa_id: 7, body: { ...base, template: 'sem link' } }), res);
  assert.strictEqual(res.statusCode, 400);
  semTabela = true; res = criarRes();
  await ctrl.salvarRenovacao(criarReq({ empresa_id: 7, body: base }), res);
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.error, /061/);
  res = criarRes();
  await ctrl.relatorioRenovacao(criarReq({ empresa_id: 7, query: { dias: '30' } }), res);
  assert.deepStrictEqual([res.body.enviadas, res.body.convertidas, res.body.taxa], [15, 4, 26.7]);
  const q = db.calls.find((c) => /FROM whatsapp_cobrancas c/.test(c.sql));
  assert.deepStrictEqual(q.params, [7, 30]);
});
