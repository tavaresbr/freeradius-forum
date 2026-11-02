// Varios numeros de WhatsApp por empresa: limite do plano, instancia por numero, webhook por instancia e envio pelo numero da conversa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const nums = require('../../src/utils/whatsappNumeros');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };
const cfgEmpresa = JSON.stringify({ api_url: 'http://evo', api_key: 'chave-propria', instance_name: 'empresa_7' });

test('nomeValido, nomeInstancia e limite (principal conta 1; NULL = ilimitado)', () => {
  assert.strictEqual(nums.nomeValido('  Financeiro \n'), 'Financeiro');
  assert.strictEqual(nums.nomeValido(''), null);
  assert.strictEqual(nums.nomeValido('x'.repeat(61)), null);
  assert.strictEqual(nums.nomeValido(null), null);
  assert.strictEqual(nums.nomeInstancia(7, 5), 'empresa_7_n5');
  assert.strictEqual(nums.limiteTotal(null), null);
  assert.strictEqual(nums.limiteTotal(0), 1);
  assert.strictEqual(nums.podeAdicionar(1, 0).ok, false);   // plano de 1 numero: so o principal
  assert.strictEqual(nums.podeAdicionar(2, 0).ok, true);
  assert.strictEqual(nums.podeAdicionar(2, 1).ok, false);
  assert.strictEqual(nums.podeAdicionar(null, 50).ok, true);
});

test('getEvolutionConfig: numero adicional usa a instancia propria; de outra empresa/removido NUNCA cai no principal', async () => {
  limpar();
  const db = criarDb(async (sql, p) => {
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: cfgEmpresa }]];
    if (/FROM whatsapp_numeros WHERE id = \? AND empresa_id = \?/.test(sql)) return p[0] === 3 && p[1] === 7 ? [[{ id: 3, nome: 'Financeiro', instance_name: 'empresa_7_n3' }]] : [[]];
  });
  const wpp = carregar('src/controllers/whatsappController.js', { db });
  assert.strictEqual((await wpp.getEvolutionConfig(7)).instanceName, 'empresa_7');
  assert.strictEqual((await wpp.getEvolutionConfig(7, 0)).instanceName, 'empresa_7');
  const extra = await wpp.getEvolutionConfig(7, 3);
  assert.strictEqual(extra.instanceName, 'empresa_7_n3');
  assert.strictEqual(extra.apiKey, 'chave-propria');
  await assert.rejects(() => wpp.getEvolutionConfig(8, 3), (e) => e.code === 'NUMERO_WHATSAPP_INVALIDO');
  await assert.rejects(() => wpp.getEvolutionConfig(7, 99), (e) => e.code === 'NUMERO_WHATSAPP_INVALIDO');
});

// ---------- webhook ----------
async function webhook(instancia, extrasNumero) {
  limpar();
  const chamadas = [];
  const db = criarDb(async (sql, p) => {
    if (/FROM whatsapp_numeros WHERE empresa_id = \? AND instance_name = \?/.test(sql)) return extrasNumero && p[1] === extrasNumero.instance_name ? [[extrasNumero]] : [[]];
  });
  const ctrl = carregar('src/controllers/atendimentoController.js', { db, extras: {
    'src/services/whatsappAtendimento.js': {
      empresaPorWebhookToken: async () => ({ empresaId: 7, instancia: 'empresa_7' }),
      registrarEvento() {},
      processarWebhook: async (...a) => { chamadas.push(a); },
    },
  } });
  const res = criarRes();
  await ctrl.receberWebhook(criarReq({ params: { token: 'a'.repeat(48) }, body: { instance: instancia, event: 'messages.upsert', data: {} } }), res);
  return { chamadas, res };
}

test('webhook: instancia principal = numero 0; instancia de numero da empresa = o id dele; desconhecida e ignorada', async () => {
  let r = await webhook('empresa_7');
  assert.strictEqual(r.chamadas.length, 1);
  assert.strictEqual(r.chamadas[0][2], 0);
  r = await webhook('empresa_7_n3', { id: 3, nome: 'Financeiro', instance_name: 'empresa_7_n3' });
  assert.strictEqual(r.chamadas[0][2], 3);
  r = await webhook('empresa_8_n1', { id: 3, nome: 'x', instance_name: 'empresa_7_n3' });
  assert.strictEqual(r.chamadas.length, 0);
  assert.strictEqual(r.res.body.ignorado, true);
});

// ---------- envio e recebimento ----------
function carregarServico({ numeroDaConversa = 0, chamou = [], configs = [] } = {}) {
  limpar();
  const db = criarDb(async (sql) => {
    if (/SELECT numero_id FROM whatsapp_conversas/.test(sql)) return [[{ numero_id: numeroDaConversa }]];
    if (/^INSERT INTO whatsapp_mensagens/.test(sql)) return [{ insertId: 11 }];
    if (/^INSERT INTO whatsapp_conversas/.test(sql)) return [{ insertId: 9 }];
    if (/^INSERT IGNORE INTO whatsapp_mensagens/.test(sql)) return [{ affectedRows: 1, insertId: 4 }];
  });
  return { db, svc: carregar('src/services/whatsappAtendimento.js', { db, extras: {
    'src/utils/schemaCache.js': { temColuna: async () => true },
    'src/controllers/whatsappController.js': {
      getEvolutionConfig: async (e, n) => { configs.push(n); return { apiUrl: 'http://evo', apiKey: 'k', instanceName: n ? `empresa_${e}_n${n}` : `empresa_${e}` }; },
      formatarNumeroComNonoDigito: (x) => x,
    },
    'src/services/whatsappSatisfacao.js': { capturarNota: async () => false },
    'src/services/whatsappPosCompra.js': { aoReceberNota: async () => {} },
    'src/services/whatsappChatbot.js': { processar: async () => { chamou.push('chatbot'); return { tratada: false }; } },
    'src/services/whatsappAutomacao.js': { responderAutomatico: async () => { chamou.push('auto'); } },
  } }) };
}

test('enviarMensagem: responde pelo numero da conversa (campo da conversa ou lido do banco)', async () => {
  const original = axios.post;
  const urls = [];
  axios.post = async (url) => { urls.push(url); return { data: { key: { id: 'W1' } } }; };
  try {
    const configs = [];
    let { svc } = carregarServico({ configs });
    await svc.enviarTexto(7, 1, { id: 5, numero_id: 3, telefone: '5593999990000', jid: 'x@s.whatsapp.net' }, 'oi');
    assert.ok(urls[0].endsWith('/message/sendText/empresa_7_n3'), urls[0]);
    assert.strictEqual(configs[0], 3);

    // conversa carregada sem o campo (outros jobs): o numero e' lido do banco, nunca assume o principal
    ({ svc } = carregarServico({ numeroDaConversa: 4 }));
    await svc.enviarTexto(7, 1, { id: 5, telefone: '5593999990000', jid: 'x@s.whatsapp.net' }, 'oi');
    assert.ok(urls[1].endsWith('/message/sendText/empresa_7_n4'), urls[1]);

    // conversa do principal
    ({ svc } = carregarServico({ numeroDaConversa: 0 }));
    await svc.enviarTexto(7, 1, { id: 5, numero_id: 0, telefone: '5593999990000', jid: 'x@s.whatsapp.net' }, 'oi');
    assert.ok(urls[2].endsWith('/message/sendText/empresa_7'), urls[2]);
  } finally { axios.post = original; }
});

test('enviarMensagem: numero removido -> 400 claro e a mensagem nao sai pelo principal', async () => {
  limpar();
  const original = axios.post;
  let enviou = false;
  axios.post = async () => { enviou = true; return { data: {} }; };
  try {
    const db = criarDb();
    const svc = carregar('src/services/whatsappAtendimento.js', { db, extras: {
      'src/controllers/whatsappController.js': {
        getEvolutionConfig: async () => { throw Object.assign(new Error('x'), { code: 'NUMERO_WHATSAPP_INVALIDO' }); },
        formatarNumeroComNonoDigito: (x) => x,
      },
    } });
    await assert.rejects(() => svc.enviarTexto(7, 1, { id: 5, numero_id: 3, telefone: '5593999990000', jid: 'j' }, 'oi'), (e) => e.status === 400 && /removido/.test(e.message));
    assert.strictEqual(enviou, false);
  } finally { axios.post = original; }
});

const payload = { key: { id: 'ABC', remoteJid: '5593999990000@s.whatsapp.net', fromMe: false }, pushName: 'Maria', message: { conversation: 'oi' }, messageTimestamp: 1760000000 };

test('recebimento: conversa nasce com o numero; chatbot e resposta automatica so no principal', async () => {
  const chamou = [];
  let { db, svc } = carregarServico({ chamou });
  await svc.registrarMensagem(7, payload, 2);
  const ins = db.calls.find((c) => /^INSERT INTO whatsapp_conversas/.test(c.sql));
  assert.match(ins.sql, /numero_id/);
  assert.deepStrictEqual(ins.params.slice(0, 2), [7, 2]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(chamou, []); // numero 2: nada automatico

  ({ db, svc } = carregarServico({ chamou }));
  await svc.registrarMensagem(7, payload, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(chamou, ['chatbot', 'auto']);
});

// ---------- criar numero (controller) ----------
async function criar({ limite, existentes = 0, totalDepois = null, corpo = { nome: 'Financeiro' }, axiosPost }) {
  limpar();
  const original = axios.post;
  const posts = [];
  axios.post = axiosPost || (async (url, body) => { posts.push({ url, body }); return { data: {} }; });
  try {
    const db = criarDb(async (sql, p) => {
      if (/FROM empresa_configs/.test(sql)) return [[{ config_json: cfgEmpresa }]];
      if (/COUNT\(\*\) AS n FROM whatsapp_numeros/.test(sql)) return [[{ n: existentes }]];
      if (/COUNT\(\*\) AS total FROM whatsapp_numeros/.test(sql)) return [[{ total: totalDepois ?? existentes + 1 }]];
      if (/^INSERT INTO whatsapp_numeros/.test(sql)) return [{ insertId: 5 }];
    });
    const ctrl = carregar('src/controllers/whatsappNumerosController.js', { db, extras: {
      'src/utils/assinatura.js': { obterStatus: async () => ({ max_whatsapp_numeros: limite }), tabelaInexistente: () => false },
      'src/services/whatsappAtendimento.js': { ativarWebhook: async () => ({ ativo: true }) },
    } });
    const res = criarRes();
    await ctrl.criar(criarReq({ empresa_id: 7, body: corpo }), res);
    return { db, res, posts };
  } finally { axios.post = original; }
}

test('criar numero: plano de 1 numero recusa (403) sem tocar na Evolution nem gravar', async () => {
  const { db, res, posts } = await criar({ limite: 1 });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'LIMITE_WHATSAPP_NUMEROS');
  assert.strictEqual(posts.length, 0);
  assert.ok(!db.calls.some((c) => /^INSERT INTO whatsapp_numeros/.test(c.sql)));
});

test('criar numero: dentro do limite cria a instancia empresa_<id>_n<numero> e grava o nome da instancia', async () => {
  const { db, res, posts } = await criar({ limite: 2 });
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.numero.instance_name, 'empresa_7_n5');
  assert.strictEqual(posts[0].body.instanceName, 'empresa_7_n5');
  assert.ok(posts[0].url.endsWith('/instance/create'));
  const upd = db.calls.find((c) => /^UPDATE whatsapp_numeros SET instance_name/.test(c.sql));
  assert.deepStrictEqual(upd.params, ['empresa_7_n5', 5, 7]);
});

test('criar numero: duas criacoes ao mesmo tempo nao passam do limite (reconfere e desfaz)', async () => {
  const { db, res, posts } = await criar({ limite: 2, existentes: 0, totalDepois: 2 });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(posts.length, 0);
  assert.ok(db.calls.some((c) => /^DELETE FROM whatsapp_numeros/.test(c.sql) && c.params[0] === 5));
});

test('criar numero: falha na Evolution desfaz o cadastro; nome invalido = 400', async () => {
  let r = await criar({ limite: 3, axiosPost: async () => { throw Object.assign(new Error('boom'), { response: { status: 500, data: {} } }); } });
  assert.strictEqual(r.res.statusCode, 500);
  assert.ok(r.db.calls.some((c) => /^DELETE FROM whatsapp_numeros/.test(c.sql)));
  r = await criar({ limite: 3, corpo: { nome: '   ' } });
  assert.strictEqual(r.res.statusCode, 400);
});

test('remover/qrcode: numero de OUTRA empresa responde 404', async () => {
  limpar();
  const db = criarDb(async (sql) => { if (/FROM whatsapp_numeros WHERE id = \? AND empresa_id = \?/.test(sql)) return [[]]; });
  const ctrl = carregar('src/controllers/whatsappNumerosController.js', { db, extras: {
    'src/utils/assinatura.js': { obterStatus: async () => ({}), tabelaInexistente: () => false },
  } });
  for (const f of ['remover', 'qrcode', 'desconectar', 'renomear']) {
    const res = criarRes();
    await ctrl[f](criarReq({ empresa_id: 7, params: { id: '3' }, body: { nome: 'x' } }), res);
    assert.strictEqual(res.statusCode, 404, f);
  }
});
