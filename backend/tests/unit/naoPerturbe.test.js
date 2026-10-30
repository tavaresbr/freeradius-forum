// Nao perturbe: horario de silencio (puro), lista central, controller e envios proativos respeitando ambos.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const sil = require('../../src/utils/silencio');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };
const cfgNoite = (o = {}) => ({ ativo: true, fuso: 'America/Sao_Paulo', de: '21:00', ate: '08:00', dias: [0, 1, 2, 3, 4, 5, 6], aplicar_a: ['promocao', 'renovacao'], ...o });
// 2026-10-28 (quarta) em Sao Paulo = UTC-3
const sp = (iso) => new Date(`${iso}-03:00`);

test('silencio: janela que cruza a meia-noite, so tipos escolhidos, desligado nunca silencia', () => {
  const c = cfgNoite();
  assert.strictEqual(sil.dentroDoSilencio(c, 'promocao', sp('2026-10-28T22:00:00')), true);
  assert.strictEqual(sil.dentroDoSilencio(c, 'promocao', sp('2026-10-29T03:00:00')), true, 'madrugada pertence a noite anterior');
  assert.strictEqual(sil.dentroDoSilencio(c, 'promocao', sp('2026-10-28T12:00:00')), false);
  assert.strictEqual(sil.dentroDoSilencio(c, 'promocao', sp('2026-10-28T08:00:00')), false, 'fim exclusivo');
  assert.strictEqual(sil.dentroDoSilencio(c, 'pos_compra', sp('2026-10-28T22:00:00')), false, 'tipo fora de aplicar_a');
  assert.strictEqual(sil.dentroDoSilencio({ ...c, ativo: false }, 'promocao', sp('2026-10-28T22:00:00')), false);
  // so quarta: quinta de madrugada ainda e' a noite de quarta; quarta de madrugada (noite de terca) nao
  const q = cfgNoite({ dias: [3] });
  assert.strictEqual(sil.dentroDoSilencio(q, 'promocao', sp('2026-10-29T03:00:00')), true);
  assert.strictEqual(sil.dentroDoSilencio(q, 'promocao', sp('2026-10-28T03:00:00')), false);
  // janela no mesmo dia
  const d = cfgNoite({ de: '12:00', ate: '14:00' });
  assert.strictEqual(sil.dentroDoSilencio(d, 'promocao', sp('2026-10-28T13:00:00')), true);
  assert.strictEqual(sil.dentroDoSilencio(d, 'promocao', sp('2026-10-28T15:00:00')), false);
});

test('validarSilencio: horario, fuso, dias e tipos', () => {
  const ok = sil.validarSilencio({ ativo: true, de: '22:00', ate: '07:30', dias: [6, 0, 0, 9], aplicar_a: ['promocao', 'x'] });
  assert.deepStrictEqual(ok.dias, [0, 6]);
  assert.deepStrictEqual(ok.aplicar_a, ['promocao']);
  assert.throws(() => sil.validarSilencio({ de: '25:00', ate: '08:00' }), /Horário inválido/);
  assert.throws(() => sil.validarSilencio({ de: '08:00', ate: '08:00' }), /iguais/);
  assert.throws(() => sil.validarSilencio({ fuso: 'Marte/Olimpo' }), /Fuso/);
  assert.throws(() => sil.validarSilencio({ ativo: true, dias: [] }), /ao menos um dia/);
  assert.strictEqual(sil.mesclarComPadrao(undefined).ativo, false);
});

function helper({ lista = [], optouts = [], cfg = null, semTabela = false } = {}) {
  limpar();
  const db = criarDb(async (sql, params) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM whatsapp_nao_perturbe/.test(sql)) {
      if (semTabela) { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
      return [lista.filter((f) => params.includes(f)).map((f) => ({ telefone_fim10: f, id: 1 }))];
    }
    if (/FROM leads WHERE empresa_id = \? AND whatsapp_optout = 1/.test(sql)) return [optouts.filter((f) => params.includes(f)).map((f) => ({ f, id: 2 }))];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [cfg ? [{ config_json: JSON.stringify({ nao_perturbe: cfg }) }] : []];
    if (/^INSERT IGNORE INTO whatsapp_nao_perturbe/.test(sql)) return [{ affectedRows: 1 }];
  });
  return { db, np: carregar('src/utils/naoPerturbe.js', { db }) };
}

test('naoPerturbe: bloqueia por lista OU opt-out do lead (10 ultimos digitos); tabela ausente nao derruba', async () => {
  const { np, db } = helper({ lista: ['3988887777'], optouts: ['3977776666'] });
  assert.strictEqual(await np.estaBloqueado(7, '5593988887777'), true);
  assert.strictEqual(await np.estaBloqueado(7, '93977776666'), true);
  assert.strictEqual(await np.estaBloqueado(7, '5511911112222'), false);
  assert.strictEqual(await np.estaBloqueado(7, '123'), false);
  assert.ok(db.calls.filter((c) => /FROM whatsapp_nao_perturbe|FROM leads/.test(c.sql)).every((c) => c.params[0] === 7), 'sempre por empresa');
  const set = await np.bloqueados(7, ['5593988887777', '93977776666', '5511911112222', '5593988887777']);
  assert.deepStrictEqual([...set].sort(), ['3977776666', '3988887777']);
  const sem = helper({ optouts: ['3977776666'], semTabela: true });
  assert.strictEqual(await sem.np.estaBloqueado(7, '93977776666'), true, 'opt-out do lead segue valendo');
  assert.strictEqual(await sem.np.estaBloqueado(7, '93988887777'), false);
});

test('naoPerturbe.emSilencio le a config da empresa e adicionar grava com INSERT IGNORE', async () => {
  const on = helper({ cfg: cfgNoite() });
  assert.strictEqual(await on.np.emSilencio(7, 'promocao', sp('2026-10-28T23:00:00')), true);
  assert.strictEqual(await on.np.emSilencio(7, 'promocao', sp('2026-10-28T10:00:00')), false);
  const off = helper();
  assert.strictEqual(await off.np.emSilencio(7, 'promocao', sp('2026-10-28T23:00:00')), false, 'padrao desligado');
  assert.strictEqual(await off.np.adicionar(7, '5593988887777', { origem: 'sair' }), true);
  const ins = off.db.calls.find((c) => /INSERT IGNORE INTO whatsapp_nao_perturbe/.test(c.sql));
  assert.deepStrictEqual(ins.params.slice(0, 2), [7, '3988887777']);
  assert.strictEqual(await off.np.adicionar(7, '123'), false);
});

test('controller: adiciona por telefone valido, importa (dedupe/invalidos/limite), remove escopado e exporta CSV', async () => {
  limpar();
  const db = criarDb(async (sql, params) => {
    if (/^INSERT IGNORE INTO whatsapp_nao_perturbe/.test(sql)) return [{ affectedRows: Array.isArray(params[0]) ? params[0].length - 1 : 1 }];
    if (/^DELETE FROM whatsapp_nao_perturbe/.test(sql)) return [{ affectedRows: params[0] === 5 ? 1 : 0 }];
    if (/^SELECT telefone, motivo/.test(sql)) return [[{ telefone: '5593988887777', motivo: '=cmd', origem: 'manual', criado_em: new Date('2026-10-01T00:00:00Z') }]];
  });
  const ctrl = carregar('src/controllers/naoPerturbeController.js', { db });
  let res = criarRes();
  await ctrl.adicionar(criarReq({ empresa_id: 7, body: { telefone: '(93) 98888-7777', motivo: 'pediu' } }), res);
  assert.strictEqual(res.body.adicionado, true);
  res = criarRes();
  await ctrl.adicionar(criarReq({ empresa_id: 7, body: { telefone: '12' } }), res);
  assert.strictEqual(res.statusCode, 400);

  res = criarRes();
  await ctrl.importar(criarReq({ empresa_id: 7, body: { telefones: ['93988887777', '(93) 98888-7777', 'abc', '5511911112222', 5593977776666] } }), res);
  assert.strictEqual(res.body.invalidos, 1);
  assert.strictEqual(res.body.adicionados + res.body.repetidos, 3, '3 numeros distintos');
  const ins = db.calls.filter((c) => /INSERT IGNORE INTO whatsapp_nao_perturbe .* VALUES \?/.test(c.sql)).pop();
  assert.ok(ins.params[0].every((l) => l[0] === 7), 'empresa do token em todas as linhas');
  res = criarRes();
  await ctrl.importar(criarReq({ empresa_id: 7, body: { telefones: new Array(5001).fill('93988887777') } }), res);
  assert.strictEqual(res.statusCode, 400);

  res = criarRes();
  await ctrl.remover(criarReq({ empresa_id: 7, params: { id: '9' } }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(db.calls.filter((c) => /^DELETE/.test(c.sql)).pop().params, [9, 7]);

  res = criarRes();
  await ctrl.exportar(criarReq({ empresa_id: 7 }), res);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.body, /"'=cmd"/, 'anti-formula');
});

test('controller: salvar config valida e preserva as outras chaves; sem tabela responde pronto:false', async () => {
  limpar();
  const db = criarDb(async (sql) => {
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ api_key: 'k', renovacao: { ativo: true } }) }]];
    if (/SELECT id FROM empresa_configs/.test(sql)) return [[{ id: 1 }]];
    if (/FROM whatsapp_nao_perturbe/.test(sql)) { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
  });
  const ctrl = carregar('src/controllers/naoPerturbeController.js', { db });
  let res = criarRes();
  await ctrl.salvarConfig(criarReq({ empresa_id: 7, body: { ativo: true, de: '22:00', ate: '07:00', dias: [1, 2] } }), res);
  assert.strictEqual(res.body.success, true);
  const salvo = JSON.parse(db.calls.find((c) => /UPDATE empresa_configs SET config_json/.test(c.sql)).params[0]);
  assert.strictEqual(salvo.api_key, 'k');
  assert.strictEqual(salvo.renovacao.ativo, true);
  assert.strictEqual(salvo.nao_perturbe.de, '22:00');
  res = criarRes();
  await ctrl.salvarConfig(criarReq({ empresa_id: 7, body: { de: '99:00' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await ctrl.listar(criarReq({ empresa_id: 7, query: {} }), res);
  assert.strictEqual(res.body.pronto, false);
  assert.match(res.body.aviso, /063/);
});

// ---------- envios proativos ----------
function jobPromocao({ cfg = null, lista = [], pendentes }) {
  limpar();
  const enviados = [];
  const db = criarDb(async (sql, params) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [cfg ? [{ config_json: JSON.stringify({ nao_perturbe: cfg }) }] : []];
    if (/FROM whatsapp_nao_perturbe/.test(sql)) return [lista.filter((f) => params.includes(f)).map((f) => ({ id: 1, telefone_fim10: f }))];
    if (/FROM promocao_envios WHERE status = 'em_andamento'/.test(sql)) return [[{ id: 1, empresa_id: 7, mensagem: 'Oi {{nome}}', tipo: 'promocao' }]];
    if (/FROM promocao_destinatarios\s+WHERE envio_id = \? AND status = 'pendente'/.test(sql)) return [pendentes];
    if (/^SELECT status FROM promocao_envios/.test(sql)) return [[{ status: 'em_andamento' }]];
    if (/GROUP BY status/.test(sql)) return [[{ status: 'pendente', n: pendentes.length }]];
    if (/^SELECT whatsapp_optout FROM leads/.test(sql)) return [[{ whatsapp_optout: 0 }]];
  });
  const fn = carregar('src/jobs/enviaPromocoes.js', { db, extras: { 'src/controllers/whatsappController.js': {
    instanciaConectada: async () => true, enviarMensagemEstrita: async (tel) => { enviados.push(tel); } } } });
  return { fn, enviados, db };
}
const dest = (id, lead, tel) => ({ id, lead_id: lead, telefone: tel, nome: `Cli ${id}` });
const RealDate = Date;
function congelar(iso) {
  const t = new RealDate(iso).getTime();
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } };
  return () => { global.Date = RealDate; };
}

test('promocao: dentro do silencio a fila apenas espera (nada enviado nem marcado); fora dele envia', async () => {
  const volta = congelar('2026-10-29T01:30:00Z'); // 22:30 em Sao Paulo
  try {
    const j = jobPromocao({ cfg: cfgNoite(), pendentes: [dest(1, 10, '5511988887777')] });
    await j.fn({ dormir: async () => {} });
    assert.strictEqual(j.enviados.length, 0);
    assert.ok(!j.db.calls.some((c) => /^UPDATE promocao_destinatarios/.test(c.sql)), 'nada marcado');
  } finally { volta(); }
  const dia = congelar('2026-10-28T15:00:00Z'); // 12:00 em Sao Paulo
  try {
    const j = jobPromocao({ cfg: cfgNoite(), pendentes: [dest(1, 10, '5511988887777')] });
    await j.fn({ dormir: async () => {} });
    assert.strictEqual(j.enviados.length, 1);
  } finally { dia(); }
});

test('promocao: telefone na lista nao perturbe (sem lead) e ignorado mesmo com a fila ja criada', async () => {
  const j = jobPromocao({ lista: ['1988887777'], pendentes: [dest(1, null, '5511988887777'), dest(2, null, '5511977776666')] });
  await j.fn({ dormir: async () => {} });
  assert.deepStrictEqual(j.enviados, ['5511977776666']);
  assert.ok(j.db.calls.some((c) => /SET status = 'ignorado'/.test(c.sql)));
});

test('SAIR de quem nao e lead entra na lista nao perturbe (origem sair)', async () => {
  limpar();
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/^INSERT IGNORE INTO whatsapp_nao_perturbe/.test(sql)) return [{ affectedRows: 1 }];
    if (/^UPDATE leads SET whatsapp_optout/.test(sql)) return [{ affectedRows: 0 }];
  });
  const svc = carregar('src/services/whatsappAtendimento.js', { db });
  assert.ok(svc, 'servico carrega');
  const np = require('../../src/utils/naoPerturbe');
  assert.strictEqual(await np.adicionar(7, '5593988887777', { origem: 'sair' }), true);
});

test('erroEvolution: extrai o motivo real do corpo da Evolution em vez de "status code 400"', () => {
  const { erroEvolution } = require('../../src/utils/erroEvolution');
  const e = (data, status = 400) => Object.assign(new Error('Request failed with status code ' + status), { response: { status, data } });
  assert.strictEqual(erroEvolution(e({ response: { message: [{ jid: 'x', exists: false, number: '1' }] } })), 'Esse número não tem WhatsApp');
  assert.strictEqual(erroEvolution(e({ response: { message: ['Connection Closed'] } })), 'Connection Closed');
  assert.strictEqual(erroEvolution(e({ message: 'instance not connected' })), 'instance not connected');
  assert.match(erroEvolution(e({}, 404)), /Instância/);
  assert.match(erroEvolution(e({}, 401)), /Chave de API/);
  assert.strictEqual(erroEvolution(new Error('boom')), 'boom');
});
