// WhatsApp pos-liberacao: nao vazar o nome do titular de um CPF nem apontar a credencial por MAC.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar } = require('../helpers/mocks');

function montar({ leadPorCpf = null, leadPorId = null, lgpdPorMac = null } = {}) {
  const enviados = [];
  const db = criarDb(async (sql) => {
    if (/FROM portais WHERE id/.test(sql)) return [[{ enabled: 1, template: 'Ola {{nome}}, usuario {{username}} senha {{password}}' }]];
    if (/FROM leads WHERE id/.test(sql)) return [leadPorId ? [leadPorId] : []];
    if (/origem = 'lgpd'/.test(sql)) return [lgpdPorMac ? [lgpdPorMac] : []];
    if (/FROM leads\s+WHERE REPLACE/.test(sql)) return [leadPorCpf ? [leadPorCpf] : []];
    return undefined;
  });
  const mod = carregar('src/services/whatsappNotify.js', {
    db,
    extras: { 'src/controllers/whatsappController.js': { enviarMensagemDireta: async (tel, msg) => { enviados.push({ tel, msg }); } } },
  });
  return { mod, enviados, db };
}
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
const base = { empresa_id: 5, portal_id: 1, vars: { username: '52998224725', password: 'abc23456' } };

test('whatsapp: telefone de OUTRA pessoa + CPF do titular NAO empresta o nome do titular (CPF -> nome)', async () => {
  const { mod, enviados } = montar({ leadPorCpf: { nome: 'Maria Titular', telefone: '11988887777' } });
  const un = silencia();
  try { await mod.notificarLiberacao({ ...base, telefone: '11977776666', cpf: '52998224725' }); } finally { un(); }
  assert.strictEqual(enviados.length, 1);
  assert.ok(!/Maria/.test(enviados[0].msg), 'nome do titular nao vaza');
  assert.match(enviados[0].msg, /Ola Cliente/);
});

test('whatsapp: telefone igual ao do cadastro (mesmo com mascara) mantem o nome', async () => {
  const { mod, enviados } = montar({ leadPorCpf: { nome: 'Maria Titular', telefone: '(11) 98888-7777' } });
  const un = silencia();
  try { await mod.notificarLiberacao({ ...base, telefone: '11988887777', cpf: '52998224725' }); } finally { un(); }
  assert.match(enviados[0].msg, /Ola Maria Titular/);
});

test('whatsapp: sem telefone na mensagem herda telefone E nome do cadastro do cliente_id', async () => {
  const { mod, enviados } = montar({ leadPorId: { nome: 'Joao', telefone: '11955554444' } });
  const un = silencia();
  try { await mod.notificarLiberacao({ ...base, cliente_id: 9 }); } finally { un(); }
  assert.strictEqual(enviados[0].tel, '5511955554444');
  assert.match(enviados[0].msg, /Ola Joao/);
});

test('whatsapp: MAC (vem do cliente) NAO resolve telefone de terceiro => skipped sem_telefone', async () => {
  const { mod, enviados, db } = montar({ lgpdPorMac: { nome: 'Terceiro', telefone: '11911112222' } });
  const un = silencia(); let r;
  try { r = await mod.notificarLiberacao({ ...base, mac: 'AA:BB:CC:DD:EE:01' }); } finally { un(); }
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(r.skipped, 'sem_telefone');
  assert.ok(!db.calls.some((c) => /origem = 'lgpd'/.test(c.sql)), 'nem consulta por MAC');
});

// ---- Chave geral e trava anti-repeticao da confirmacao ao conectar ----
function montarCfg({ cfgJson = null, jaEnviado = false } = {}) {
  const enviados = [];
  const db = criarDb(async (sql) => {
    if (/FROM portais WHERE id/.test(sql)) return [[{ enabled: 1, template: 'Ola {{nome}}, usuario {{username}}' }]];
    if (/FROM empresa_configs/.test(sql)) return cfgJson ? [[{ config_json: JSON.stringify(cfgJson) }]] : [[]];
    if (/FROM whatsapp_logs/.test(sql)) return jaEnviado ? [[{ id: 1 }]] : [[]];
    return undefined;
  });
  const mod = carregar('src/services/whatsappNotify.js', {
    db,
    extras: { 'src/controllers/whatsappController.js': { enviarMensagemDireta: async (tel, msg) => { enviados.push({ tel, msg }); } } },
  });
  return { mod, enviados, db };
}

test('confirmacao: chave da empresa desligada => nao envia, em nenhum contexto (inclusive pagamento)', async () => {
  const un = silencia();
  try {
    for (const ctx of ['lgpd', 'pagamento_aprovado']) {
      const { mod, enviados, db } = montarCfg({ cfgJson: { confirmacao_conexao: { ativo: false, nao_repetir_horas: 24 } } });
      const r = await mod.notificarLiberacao({ ...base, telefone: '11977776666', contexto_tipo: ctx });
      assert.strictEqual(r.skipped, 'desativada_empresa');
      assert.strictEqual(enviados.length, 0);
      assert.ok(db.calls.some((c) => /INSERT INTO whatsapp_logs/.test(c.sql) && c.params.includes('desativada_empresa')));
    }
  } finally { un(); }
});

test('confirmacao: sem config da empresa segue ligada (comportamento antigo)', async () => {
  const { mod, enviados } = montarCfg();
  const un = silencia();
  try { await mod.notificarLiberacao({ ...base, telefone: '11977776666', contexto_tipo: 'lgpd' }); } finally { un(); }
  assert.strictEqual(enviados.length, 1);
});

test('confirmacao: trava anti-repeticao barra lgpd/lead repetido, mas NUNCA pagamento; 0 horas = sem trava', async () => {
  const un = silencia();
  try {
    let t = montarCfg({ jaEnviado: true });
    let r = await t.mod.notificarLiberacao({ ...base, telefone: '11977776666', contexto_tipo: 'lgpd' });
    assert.strictEqual(r.skipped, 'repetida');
    assert.strictEqual(t.enviados.length, 0);

    t = montarCfg({ jaEnviado: true });
    r = await t.mod.notificarLiberacao({ ...base, telefone: '11977776666', contexto_tipo: 'pagamento_aprovado' });
    assert.strictEqual(r.ok, true, 'pagamento leva a credencial recem-comprada');

    t = montarCfg({ jaEnviado: true, cfgJson: { confirmacao_conexao: { ativo: true, nao_repetir_horas: 0 } } });
    r = await t.mod.notificarLiberacao({ ...base, telefone: '11977776666', contexto_tipo: 'lgpd' });
    assert.strictEqual(r.ok, true);
    assert.ok(!t.db.calls.some((c) => /FROM whatsapp_logs/.test(c.sql)), 'sem trava nao consulta o historico');
  } finally { un(); }
});

test('confirmacao: validarConfirmacao e mesclarComPadrao', () => {
  const cc = require('../../src/utils/confirmacaoConexao');
  assert.deepStrictEqual(cc.validarConfirmacao({ ativo: false, nao_repetir_horas: 12 }), { ativo: false, nao_repetir_horas: 12 });
  assert.strictEqual(cc.validarConfirmacao({ ativo: true }).nao_repetir_horas, 24);
  assert.throws(() => cc.validarConfirmacao({ ativo: 'sim' }), /ligada ou desligada/);
  assert.throws(() => cc.validarConfirmacao({ ativo: true, nao_repetir_horas: -1 }), /0 a 168/);
  assert.throws(() => cc.validarConfirmacao({ ativo: true, nao_repetir_horas: 1.5 }), /0 a 168/);
  assert.deepStrictEqual(cc.mesclarComPadrao(undefined), { ativo: true, nao_repetir_horas: 24 });
  assert.strictEqual(cc.mesclarComPadrao({ ativo: false }).ativo, false);
});
