// Varios numeros de WhatsApp - Fase 2: numero de envio por campanha, numero padrao dos envios automaticos e
// conexao das agendadas pelo numero da conversa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };
const cfgEmpresa = (extra = {}) => JSON.stringify({ api_url: 'http://evo', api_key: 'chave', instance_name: 'empresa_7', ...extra });
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

function dbNumeros({ padrao = 0, existentes = [3] } = {}) {
  return criarDb(async (sql, p) => {
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: cfgEmpresa(padrao ? { numero_envios: { numero_id: padrao } } : {}) }]];
    if (/FROM whatsapp_numeros WHERE id = \? AND empresa_id = \?/.test(sql)) return existentes.includes(p[0]) && p[1] === 7 ? [[{ id: p[0], nome: 'N', instance_name: `empresa_7_n${p[0]}` }]] : [[]];
  });
}

test('enviarMensagemEstrita/Direta: sem numero = principal; com numero = instancia do numero; invalido lanca', async () => {
  limpar();
  const original = axios.post;
  const urls = [];
  axios.post = async (url) => { urls.push(url); return { data: {} }; };
  try {
    const wpp = carregar('src/controllers/whatsappController.js', { db: dbNumeros() });
    await wpp.enviarMensagemEstrita('5593999990000', 'oi', 7);
    await wpp.enviarMensagemEstrita('5593999990000', 'oi', 7, 3);
    await wpp.enviarMensagemDireta('5593999990000', 'oi', 7, 3);
    assert.deepStrictEqual(urls.map((u) => u.split('/').pop()), ['empresa_7', 'empresa_7_n3', 'empresa_7_n3']);
    await assert.rejects(() => wpp.enviarMensagemEstrita('5593999990000', 'oi', 7, 99), (e) => e.code === 'NUMERO_WHATSAPP_INVALIDO');
    assert.strictEqual(urls.length, 3, 'nada enviado pelo numero invalido');
  } finally { axios.post = original; }
});

test('numeroEnvio: idValido, numeroPadrao (config, removido volta a 0) e validarNumero', async () => {
  limpar();
  const ne = carregar('src/utils/numeroEnvio.js', { db: dbNumeros({ padrao: 3 }) });
  assert.deepStrictEqual([ne.idValido(undefined), ne.idValido('2'), ne.idValido(-1), ne.idValido('x'), ne.idValido(1.5)], [0, 2, null, null, null]);
  assert.strictEqual(await ne.numeroPadrao(7), 3);
  assert.strictEqual(await ne.numeroPadrao(8), 0, 'numero que nao e da empresa');
  limpar();
  const removido = carregar('src/utils/numeroEnvio.js', { db: dbNumeros({ padrao: 5, existentes: [3] }) });
  assert.strictEqual(await removido.numeroPadrao(7), 0, 'padrao removido volta ao principal');
  assert.strictEqual(await removido.validarNumero(7, 0), 0);
  assert.strictEqual(await removido.validarNumero(7, 3), 3);
  await assert.rejects(() => removido.validarNumero(7, 9), (e) => e.status === 400);
  await assert.rejects(() => removido.validarNumero(7, 'abc'), (e) => e.status === 400);
  // erro de banco nunca derruba: principal
  const quebrado = carregar('src/utils/numeroEnvio.js', { db: criarDb(async () => { throw new Error('db'); }) });
  assert.strictEqual(await quebrado.numeroPadrao(7), 0);
});

test('numero padrao: salvar valida (de outra empresa = 400) e grava em numero_envios; remover o numero padrao zera', async () => {
  limpar();
  const un = semLog();
  try {
    const db = dbNumeros({ padrao: 3 });
    const ctrl = carregar('src/controllers/whatsappNumerosController.js', { db, extras: {
      'src/utils/assinatura.js': { obterStatus: async () => ({}), tabelaInexistente: () => false },
    } });
    let res = criarRes();
    await ctrl.salvarPadrao(criarReq({ empresa_id: 7, body: { numero_id: 9 } }), res);
    assert.strictEqual(res.statusCode, 400);
    res = criarRes();
    await ctrl.salvarPadrao(criarReq({ empresa_id: 7, body: { numero_id: 3 } }), res);
    assert.strictEqual(res.statusCode, 200);
    const upd = db.calls.find((c) => /^UPDATE empresa_configs/.test(c.sql));
    assert.deepStrictEqual(JSON.parse(upd.params[0]).numero_envios, { numero_id: 3 });
    res = criarRes();
    await ctrl.obterPadrao(criarReq({ empresa_id: 7 }), res);
    assert.strictEqual(res.body.numero_id, 3);
  } finally { un(); }
});

test('enviaPromocoes: confere conexao e envia pelo numero do envio; numero desconectado/removido pausa', async () => {
  limpar();
  const un = semLog();
  try {
    const chamadas = [];
    const mk = (conectada) => carregar('src/jobs/enviaPromocoes.js', {
      db: criarDb(async (sql) => {
        if (/FROM promocao_envios WHERE status = 'em_andamento'/.test(sql)) return [[{ id: 1, empresa_id: 7, numero_id: 3, mensagem: 'Oi {{nome}}' }]];
        if (/FROM promocao_destinatarios\s+WHERE envio_id = \? AND status = 'pendente'/.test(sql)) return [[{ id: 1, lead_id: null, telefone: '5511988887777', nome: 'Ana' }]];
        if (/^SELECT status FROM promocao_envios/.test(sql)) return [[{ status: 'em_andamento' }]];
        if (/GROUP BY status/.test(sql)) return [[]];
      }),
      extras: { 'src/controllers/whatsappController.js': {
        instanciaConectada: async (emp, n) => { chamadas.push(['conn', n]); return conectada; },
        enviarMensagemEstrita: async (tel, msg, emp, n) => { chamadas.push(['envio', n]); },
      } },
    });
    await mk(true)({ dormir: async () => {} });
    assert.deepStrictEqual(chamadas, [['conn', 3], ['envio', 3]]);
    chamadas.length = 0; limpar();
    const off = mk(false);
    await off({ dormir: async () => {} });
    assert.deepStrictEqual(chamadas, [['conn', 3]]);
  } finally { un(); }
});

test('promocao criar: numero_id de outra empresa = 400; numero desconectado = 409; ok grava numero_id', async () => {
  limpar();
  const un = semLog();
  try {
    const mk = (conectada) => {
      limpar();
      const db = dbNumeros();
      return { db, ctrl: carregar('src/controllers/promocaoWhatsappController.js', { db, extras: {
        'src/controllers/whatsappController.js': { instanciaConectada: async () => conectada, enviarMensagemEstrita: async () => {} },
        'src/utils/schemaCache.js': { temColuna: async () => true },
        'src/utils/promocaoWhatsapp.js': {
          validarEnvio: (b) => ({ ok: true, nome: 'n', mensagem: b.mensagem || 'x' }),
          selecionarDestinatarios: async () => ({ destinatarios: [{ lead_id: 1, telefone: '5511988887777', nome: 'A' }], filtros: {} }),
        },
      } }) };
    };
    const corpo = (numero_id) => ({ nome: 'n', mensagem: 'x', numero_id });
    let c = mk(true), res = criarRes();
    await c.ctrl.criar(criarReq({ empresa_id: 7, body: corpo(9) }), res);
    assert.strictEqual(res.statusCode, 400);
    c = mk(false); res = criarRes();
    await c.ctrl.criar(criarReq({ empresa_id: 7, body: corpo(3) }), res);
    assert.strictEqual(res.statusCode, 409);
    c = mk(true); res = criarRes();
    await c.ctrl.criar(criarReq({ empresa_id: 7, body: corpo(3) }), res);
    assert.ok(c.db.calls.some((x) => /^UPDATE promocao_envios SET numero_id = \?/.test(x.sql) && x.params[0] === 3 && x.params[2] === 7));
  } finally { un(); }
});

test('processaAgendadas: conexao conferida pelo numero da conversa', async () => {
  limpar();
  const un = semLog();
  try {
    const conn = [];
    const enviados = [];
    const job = carregar('src/jobs/processaAgendadas.js', {
      db: criarDb(async (sql, p) => {
        if (/FROM whatsapp_agendadas/.test(sql) && /^SELECT/.test(sql)) return [[
          { id: 1, empresa_id: 7, conversa_id: 10, tipo: 'mensagem', texto: 'a', enviar_em: new Date(), criado_em: new Date() },
          { id: 2, empresa_id: 7, conversa_id: 11, tipo: 'mensagem', texto: 'b', enviar_em: new Date(), criado_em: new Date() },
        ]];
        if (/^UPDATE whatsapp_agendadas SET status = 'enviada'/.test(sql)) return [{ affectedRows: 1 }];
        if (/^SELECT \* FROM whatsapp_conversas/.test(sql)) return [[{ id: p[0], numero_id: p[0] === 10 ? 0 : 3 }]];
      }),
      extras: {
        'src/utils/assinatura.js': { temRecurso: async () => true },
        'src/controllers/whatsappController.js': { instanciaConectada: async (e, n) => { conn.push(n); return n === 0; } },
        'src/services/whatsappAtendimento.js': { enviarTexto: async (e, a, conversa) => { enviados.push(conversa.numero_id); } },
      },
    });
    await (job.processaAgendadas || job)();
    assert.deepStrictEqual(conn, [0, 3]); // 1 checagem por numero
    assert.deepStrictEqual(enviados, [0]); // o numero 3 esta desconectado: volta para a fila
  } finally { un(); }
});

test('promocao: previa/selecao tira quem esta na lista Nao perturbe e conta em "bloqueados"', async () => {
  limpar();
  const un = semLog();
  try {
    const db = criarDb(async (sql) => {
      if (/^SELECT id, nome, telefone FROM leads/.test(sql)) return [[
        { id: 1, nome: 'Ana', telefone: '11988887777' },
        { id: 2, nome: 'Bia', telefone: '11977776666' },
        { id: 3, nome: 'Cai', telefone: '11966665555' },
      ]];
      if (/FROM whatsapp_nao_perturbe/.test(sql)) return [[{ telefone_fim10: '1977776666' }]]; // so a Bia (ultimos 10 digitos de 5511977776666)
      if (/FROM leads WHERE empresa_id = \? AND whatsapp_optout = 1/.test(sql)) return [[]];
    });
    const u2 = carregar('src/utils/promocaoWhatsapp.js', { db });
    const sel = await u2.selecionarDestinatarios(db, {}, 7);
    assert.deepStrictEqual(sel.destinatarios.map((d) => d.nome), ['Ana', 'Cai']);
    assert.strictEqual(sel.bloqueados, 1);
  } finally { un(); }
});
