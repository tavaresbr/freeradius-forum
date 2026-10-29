// Atendimento por WhatsApp: webhook (texto, grupo, @lid, fromMe, duplicada, SAIR, status), token e controller.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => {
  for (const f of ['src/services/whatsappAtendimento.js', 'src/controllers/atendimentoController.js']) {
    delete require.cache[require.resolve(path.join(ROOT, f))];
  }
};
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
const ctrlWpp = (over = {}) => ({
  getEvolutionConfig: async () => ({ apiUrl: 'http://evo', apiKey: 'k', instanceName: 'empresa_7' }),
  formatarNumeroComNonoDigito: (n) => n,
  ...over,
});
function servico(db, w = ctrlWpp()) {
  limpar();
  return carregar('src/services/whatsappAtendimento.js', { db, extras: { 'src/controllers/whatsappController.js': w } });
}
const upsert = (over = {}) => ({
  event: 'messages.upsert', instance: 'empresa_7',
  data: { key: { remoteJid: '5593999990000@s.whatsapp.net', fromMe: false, id: 'ABC1' }, pushName: 'Maria', message: { conversation: 'Oi, preciso de ajuda' }, messageTimestamp: 1700000000, ...over },
});
// db que simula conversa nova (id 5) e insert de mensagem novo
const dbPadrao = (extra) => criarDb((sql) => {
  if (extra) { const r = extra(sql); if (r !== undefined) return r; }
  if (/SELECT id FROM whatsapp_conversas/.test(sql)) return [[]];
  if (/FROM leads WHERE empresa_id/.test(sql)) return [[]];
  if (/INSERT INTO whatsapp_conversas/.test(sql)) return [{ insertId: 5 }];
  if (/INSERT IGNORE INTO whatsapp_mensagens/.test(sql)) return [{ affectedRows: 1 }];
});

test('extrairMensagem: texto, grupo/status ignorados, @lid usa remoteJidAlt, reacao ignorada', () => {
  const s = servico(criarDb());
  const m = s.extrairMensagem(upsert().data);
  assert.strictEqual(m.tipo, 'texto');
  assert.strictEqual(m.telefone, '5593999990000');
  assert.strictEqual(m.nome, 'Maria');
  assert.strictEqual(s.extrairMensagem(upsert({ key: { remoteJid: '1203@g.us', id: 'G1' } }).data), null);
  assert.strictEqual(s.extrairMensagem(upsert({ key: { remoteJid: 'status@broadcast', id: 'S1' } }).data), null);
  assert.strictEqual(s.extrairMensagem(upsert({ message: { reactionMessage: {} } }).data), null);
  const lid = s.extrairMensagem(upsert({ key: { remoteJid: '99@lid', remoteJidAlt: '5511988887777@s.whatsapp.net', id: 'L1' } }).data);
  assert.strictEqual(lid.telefone, '5511988887777');
  const semNumero = s.extrairMensagem(upsert({ key: { remoteJid: '99@lid', id: 'L2' } }).data);
  assert.strictEqual(semNumero.telefone, null);
  assert.strictEqual(semNumero.jid, '99@lid');
  const img = s.extrairMensagem(upsert({ message: { imageMessage: { caption: 'foto' } } }).data);
  assert.strictEqual(img.tipo, 'imagem');
});

test('webhook: cria conversa, grava mensagem recebida e conta nao lida (tudo com empresa_id)', async () => {
  const db = dbPadrao();
  const s = servico(db);
  await s.processarWebhook(7, upsert());
  const ins = db.calls.find((c) => /INSERT INTO whatsapp_conversas/.test(c.sql));
  assert.strictEqual(ins.params[0], 7);
  const msg = db.calls.find((c) => /INSERT IGNORE INTO whatsapp_mensagens/.test(c.sql));
  assert.deepStrictEqual(msg.params.slice(0, 5), [7, 5, 'ABC1', 'in', 'texto']);
  const upd = db.calls.find((c) => /UPDATE whatsapp_conversas SET ultima_msg_em/.test(c.sql));
  assert.match(upd.sql, /empresa_id = \?/);
  assert.strictEqual(upd.params[2], 1); // +1 nao lida
});

test('webhook: mensagem duplicada (reentrega) nao conta de novo', async () => {
  const db = dbPadrao((sql) => (/INSERT IGNORE INTO whatsapp_mensagens/.test(sql) ? [{ affectedRows: 0 }] : undefined));
  await servico(db).processarWebhook(7, upsert());
  assert.ok(!db.calls.some((c) => /UPDATE whatsapp_conversas/.test(c.sql)));
});

test('webhook: resposta enviada pelo celular (fromMe) nao conta como nao lida', async () => {
  const db = dbPadrao();
  await servico(db).processarWebhook(7, upsert({ key: { remoteJid: '5593999990000@s.whatsapp.net', fromMe: true, id: 'OUT1' } }));
  const msg = db.calls.find((c) => /INSERT IGNORE INTO whatsapp_mensagens/.test(c.sql));
  assert.strictEqual(msg.params[3], 'out');
  const upd = db.calls.find((c) => /UPDATE whatsapp_conversas SET ultima_msg_em/.test(c.sql));
  assert.strictEqual(upd.params[2], 0);
});

test('webhook: grupo nao grava nada', async () => {
  const db = dbPadrao();
  await servico(db).processarWebhook(7, upsert({ key: { remoteJid: '1203@g.us', id: 'G1' } }));
  assert.strictEqual(db.calls.length, 0);
});

test('SAIR do cliente marca opt-out do lead da empresa; outro texto nao', async () => {
  let db = dbPadrao();
  await servico(db).processarWebhook(7, upsert({ message: { conversation: ' Sair! ' } }));
  const opt = db.calls.find((c) => /SET whatsapp_optout = 1/.test(c.sql));
  assert.ok(opt);
  assert.strictEqual(opt.params[0], 7);
  assert.strictEqual(opt.params[1], '3999990000');
  db = dbPadrao();
  await servico(db).processarWebhook(7, upsert({ message: { conversation: 'quero sair do plano' } }));
  assert.ok(!db.calls.some((c) => /whatsapp_optout/.test(c.sql)));
});

test('status de entrega so avanca (UPDATE com FIELD) e escopa por empresa', async () => {
  const db = criarDb();
  await servico(db).processarWebhook(7, { event: 'MESSAGES_UPDATE', data: { keyId: 'OUT1', status: 'READ' } });
  const u = db.calls[0];
  assert.match(u.sql, /empresa_id = \? AND wa_id = \?/);
  assert.match(u.sql, /FIELD\(status/);
  assert.strictEqual(u.params[0], 'lida');
  assert.strictEqual(u.params[1], 7);
});

test('token do webhook: formato invalido nem consulta o banco; valido devolve empresa e instancia', async () => {
  let db = criarDb();
  assert.strictEqual(await servico(db).empresaPorWebhookToken("x' OR 1=1"), null);
  assert.strictEqual(db.calls.length, 0);
  db = criarDb(() => [[{ empresa_id: 7, config_json: JSON.stringify({ instance_name: 'empresa_7' }) }]]);
  assert.deepStrictEqual(await servico(db).empresaPorWebhookToken('a'.repeat(48)), { empresaId: 7, instancia: 'empresa_7' });
});

test('controller webhook: token desconhecido = 404 sem gravar; instancia de outra empresa e ignorada', async () => {
  const fim = semLog();
  try {
    let db = criarDb(() => [[]]);
    limpar();
    let c = carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': ctrlWpp() } });
    let res = criarRes();
    await c.receberWebhook(criarReq({ params: { token: 'a'.repeat(48) }, body: upsert() }), res);
    assert.strictEqual(res.statusCode, 404);

    db = criarDb((sql) => (/JSON_EXTRACT/.test(sql) ? [[{ empresa_id: 7, config_json: JSON.stringify({ instance_name: 'empresa_7' }) }]] : undefined));
    limpar();
    c = carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': ctrlWpp() } });
    res = criarRes();
    await c.receberWebhook(criarReq({ params: { token: 'a'.repeat(48) }, body: { ...upsert(), instance: 'outra_empresa' } }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!db.calls.some((x) => /whatsapp_mensagens/.test(x.sql)));
  } finally { fim(); }
});

test('controller: conversa de outra empresa = 404; envio valida texto e usa empresa/usuario do token', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  try {
    const db = criarDb((sql, p) => {
      if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return p[1] === 7 ? [[{ id: 5, jid: '5593999990000@s.whatsapp.net', telefone: '5593999990000' }]] : [[]];
      if (/INSERT INTO whatsapp_mensagens/.test(sql)) return [{ insertId: 90 }];
    });
    limpar();
    const c = carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': ctrlWpp() } });
    let res = criarRes();
    await c.enviarMensagem(criarReq({ params: { id: '5' }, empresa_id: 8, user: { id: 1 }, body: { texto: 'oi' } }), res);
    assert.strictEqual(res.statusCode, 404);
    res = criarRes();
    await c.enviarMensagem(criarReq({ params: { id: '5' }, empresa_id: 7, user: { id: 1 }, body: { texto: '   ' } }), res);
    assert.strictEqual(res.statusCode, 400);
    let enviado;
    axios.post = async (url, body) => { enviado = { url, body }; return { data: { key: { id: 'WAID9' } } }; };
    res = criarRes();
    await c.enviarMensagem(criarReq({ params: { id: '5' }, empresa_id: 7, user: { id: 3 }, body: { texto: 'Olá!' } }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(enviado.url, 'http://evo/message/sendText/empresa_7');
    assert.strictEqual(enviado.body.number, '5593999990000');
    const ins = db.calls.find((x) => /INSERT INTO whatsapp_mensagens/.test(x.sql));
    assert.strictEqual(ins.params[0], 7);
    assert.strictEqual(ins.params[4], 'Olá!');
    assert.strictEqual(ins.params[8], 3);
    assert.ok(db.calls.some((x) => /SET wa_id = \?, status = 'enviada'/.test(x.sql) && x.params[0] === 'WAID9'));
  } finally { axios.post = postOrig; fim(); }
});

test('envio que falha na Evolution marca a mensagem como erro e responde 502', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  try {
    const db = criarDb((sql) => {
      if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[{ id: 5, jid: 'x@s.whatsapp.net', telefone: '5593999990000' }]];
      if (/INSERT INTO whatsapp_mensagens/.test(sql)) return [{ insertId: 91 }];
    });
    limpar();
    const c = carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': ctrlWpp() } });
    axios.post = async () => { throw new Error('conexao recusada'); };
    const res = criarRes();
    await c.enviarMensagem(criarReq({ params: { id: '5' }, empresa_id: 7, user: { id: 3 }, body: { texto: 'oi' } }), res);
    assert.strictEqual(res.statusCode, 502);
    assert.ok(db.calls.some((x) => /SET status = 'erro'/.test(x.sql)));
  } finally { axios.post = postOrig; fim(); }
});

test('lista de conversas sem a migration 048: 503 dizendo o que rodar (nao o erro generico)', async () => {
  const fim = semLog();
  try {
    const db = criarDb(() => { throw Object.assign(new Error("Table 'x.whatsapp_conversas' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }); });
    limpar();
    const c = carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': ctrlWpp() } });
    const res = criarRes();
    await c.listarConversas(criarReq({ empresa_id: 7, query: {} }), res);
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.body.error, /migrations 048 e 049/);
    assert.ok(!res.body.error.includes('x.whatsapp_conversas'), 'sem vazar o erro do MySQL');
  } finally { fim(); }
});
