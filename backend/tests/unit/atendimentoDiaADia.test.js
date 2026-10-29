// Atendimento WhatsApp (dia a dia): dono da conversa, busca no texto, citacao, localizacao e contato.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const ARQUIVOS = ['src/utils/schemaCache.js', 'src/services/whatsappAtendimento.js', 'src/controllers/atendimentoController.js', 'src/controllers/atendimentoExtrasController.js'];
const limpar = () => ARQUIVOS.forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
const wpp = () => ({
  getEvolutionConfig: async () => ({ apiUrl: 'http://evo', apiKey: 'k', instanceName: 'empresa_7' }),
  formatarNumeroComNonoDigito: (n) => n,
});
const conv = { id: 5, jid: '5593999990000@s.whatsapp.net', telefone: '5593999990000', nome: 'Maria' };
// db: colunas novas existem (ou nao), conversa 5 da empresa 7
const criar = ({ colunas = true, extra } = {}) => criarDb((sql, p) => {
  if (extra) { const r = extra(sql, p); if (r !== undefined) return r; }
  if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
  if (/SELECT \* FROM whatsapp_conversas WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[conv]] : [[]];
});
const ctrl = (arquivo, db, svc) => {
  limpar();
  const extras = { 'src/controllers/whatsappController.js': wpp() };
  if (svc) extras['src/services/whatsappAtendimento.js'] = svc;
  return carregar(arquivo, { db, extras });
};
const req = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: { id: '5' }, body: {}, ...over });

test('lista: filtro "eu" usa o atendente do token; traz o dono e o nome; sem a migration 051 ignora o filtro', async () => {
  let db = criar({ extra: (sql) => /FROM whatsapp_conversas WHERE/.test(sql) && !/SELECT \*/.test(sql) ? [[{ id: 5, atendente_id: 3, status: 'aberta' }]] : (/FROM admins WHERE id IN/.test(sql) ? [[{ id: 3, nome: 'Ana' }]] : undefined) });
  let res = criarRes();
  await ctrl('src/controllers/atendimentoController.js', db).listarConversas(req({ query: { status: 'aberta', atendente: 'eu' } }), res);
  const q = db.calls.find((c) => /FROM whatsapp_conversas WHERE/.test(c.sql));
  assert.match(q.sql, /atendente_id = \?/);
  assert.match(q.sql, /atendente_id, atribuido_em/);
  assert.ok(q.params.includes(3));
  assert.strictEqual(res.body.conversas[0].atendente_nome, 'Ana');

  db = criar({ colunas: false });
  res = criarRes();
  await ctrl('src/controllers/atendimentoController.js', db).listarConversas(req({ query: { status: 'aberta', atendente: 'eu' } }), res);
  const q2 = db.calls.find((c) => /FROM whatsapp_conversas WHERE/.test(c.sql));
  assert.doesNotMatch(q2.sql, /atendente_id/);
});

test('lista: filtro "sem" = sem dono; busca com 3+ letras procura tambem no texto das mensagens (empresa_id, % escapado)', async () => {
  const db = criar();
  await ctrl('src/controllers/atendimentoController.js', db).listarConversas(req({ query: { atendente: 'sem', q: '100%' } }), criarRes());
  const q = db.calls.find((c) => /FROM whatsapp_conversas WHERE/.test(c.sql));
  assert.match(q.sql, /atendente_id IS NULL/);
  assert.match(q.sql, /EXISTS \(SELECT 1 FROM whatsapp_mensagens mm WHERE mm\.conversa_id = whatsapp_conversas\.id AND mm\.empresa_id = \? AND mm\.texto LIKE \?\)/);
  assert.ok(q.params.includes('%100\\%%'));
  const curta = criar();
  await ctrl('src/controllers/atendimentoController.js', curta).listarConversas(req({ query: { q: 'ab' } }), criarRes());
  assert.doesNotMatch(curta.calls.find((c) => /FROM whatsapp_conversas WHERE/.test(c.sql)).sql, /EXISTS/);
});

test('assumir: grava o usuario do token como dono (com empresa_id) e registra nota; sem a migration = 503', async () => {
  const db = criar({ extra: (sql) => (/SELECT nome FROM admins/.test(sql) ? [[{ nome: 'Ana' }]] : undefined) });
  const res = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', db).assumirConversa(req(), res);
  assert.strictEqual(res.body.atendente_id, 3);
  const up = db.calls.find((c) => /UPDATE whatsapp_conversas SET atendente_id = \?/.test(c.sql));
  assert.deepStrictEqual(up.params, [3, 5, 7]);
  const nota = db.calls.find((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql));
  assert.match(nota.sql, /'nota'/);
  assert.match(nota.params[3], /Ana assumiu a conversa/);

  const sem = criar({ colunas: false });
  const r2 = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', sem).assumirConversa(req(), r2);
  assert.strictEqual(r2.statusCode, 503);
  assert.match(r2.body.error, /migration 051/);
});

test('transferir: so para usuario vinculado a empresa; null libera; conversa de outra empresa = 404', async () => {
  const vinculo = (sql, p) => (/FROM admin_empresas WHERE admin_id = \? AND empresa_id = \?/.test(sql) ? (p[0] === 9 && p[1] === 7 ? [[{ admin_id: 9 }]] : [[]]) : (/SELECT nome FROM admins/.test(sql) ? [[{ nome: 'Fulano' }]] : undefined));
  let db = criar({ extra: vinculo });
  let res = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', db).transferirConversa(req({ body: { admin_id: 9 } }), res);
  assert.strictEqual(res.body.atendente_id, 9);

  db = criar({ extra: vinculo });
  res = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', db).transferirConversa(req({ body: { admin_id: 77 } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!db.calls.some((c) => /UPDATE whatsapp_conversas SET atendente_id = \?/.test(c.sql)));

  db = criar({ extra: vinculo });
  res = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', db).transferirConversa(req({ body: { admin_id: null } }), res);
  assert.strictEqual(res.body.atendente_id, null);
  assert.ok(db.calls.some((c) => /atendente_id = NULL/.test(c.sql)));

  res = criarRes();
  await ctrl('src/controllers/atendimentoExtrasController.js', criar()).transferirConversa(req({ params: { id: '5' }, empresa_id: 8, body: { admin_id: 9 } }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('citacao: so cita mensagem da mesma conversa/empresa; manda "quoted" a Evolution e grava a previa', async () => {
  const postOrig = axios.post;
  const fim = semLog();
  try {
    const db = criar({ extra: (sql) => (/INSERT INTO whatsapp_mensagens/.test(sql) ? [{ insertId: 70 }] : /SELECT wa_id, direcao, texto, tipo FROM whatsapp_mensagens/.test(sql) ? [[{ wa_id: 'ABC1', direcao: 'in', texto: 'Qual o valor?', tipo: 'texto' }]] : undefined) });
    const chamadas = [];
    axios.post = async (url, body) => { chamadas.push({ url, body }); return { data: { key: { id: 'W1' } } }; };
    const res = criarRes();
    const c = ctrl('src/controllers/atendimentoController.js', db);
    await c.enviarMensagem(req({ body: { texto: 'R$ 30', responder_a: 12 } }), res);
    assert.strictEqual(res.body.success, true);
    const busca = db.calls.find((x) => /SELECT wa_id, direcao, texto, tipo FROM whatsapp_mensagens/.test(x.sql));
    assert.deepStrictEqual(busca.params, [12, 7, 5]);
    assert.deepStrictEqual(chamadas[0].body.quoted, { key: { id: 'ABC1', fromMe: false, remoteJid: conv.jid }, message: { conversation: 'Qual o valor?' } });
    const up = db.calls.find((x) => /SET resposta_a_wa_id/.test(x.sql));
    assert.deepStrictEqual(up.params.slice(0, 2), ['ABC1', 'Qual o valor?']);
  } finally { axios.post = postOrig; fim(); }
});

test('mensagem recebida: guarda a citacao e mostra localizacao e contato como texto', () => {
  limpar();
  const s = carregar('src/services/whatsappAtendimento.js', { db: criar(), extras: { 'src/controllers/whatsappController.js': wpp() } });
  const base = (message, extra = {}) => ({ key: { remoteJid: '5593999990000@s.whatsapp.net', id: 'X1' }, message, messageTimestamp: 1700000000, ...extra });
  const cit = s.extrairMensagem(base({ extendedTextMessage: { text: 'Sim', contextInfo: { stanzaId: 'ORIG9', quotedMessage: { conversation: 'Tem fibra aqui?' } } } }));
  assert.strictEqual(cit.respostaA, 'ORIG9');
  assert.strictEqual(cit.respostaPrevia, 'Tem fibra aqui?');
  const loc = s.extrairMensagem(base({ locationMessage: { degreesLatitude: -1.45, degreesLongitude: -48.5, name: 'Casa' } }));
  assert.match(loc.texto, /📍 Localização: Casa\nhttps:\/\/maps\.google\.com\/\?q=-1\.45,-48\.5/);
  assert.match(loc.previa, /Localização/);
  const ct = s.extrairMensagem(base({ contactMessage: { displayName: 'João' } }));
  assert.strictEqual(ct.texto, '👤 Contato: João');
  assert.strictEqual(s.extrairMensagem(base({ conversation: 'oi' })).respostaA, null);
});

test('enviar localizacao/contato: valida entrada e usa sendLocation/sendContact com o texto gravado', async () => {
  const chamadas = [];
  const svc = { MAX_TEXTO: 4000, textoLocalizacao: (l) => `LOC ${l.degreesLatitude},${l.degreesLongitude}`, enviarMensagem: async (...a) => { chamadas.push(a); return { id: 1 }; } };
  const db = criar();
  const c = ctrl('src/controllers/atendimentoExtrasController.js', db, svc);
  let res = criarRes();
  await c.enviarLocalizacao(req({ body: { latitude: 95, longitude: 0 } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.enviarLocalizacao(req({ body: { latitude: -1.45, longitude: -48.5, nome: 'Loja' } }), res);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(chamadas[0][3].especial.endpoint, 'sendLocation');
  assert.deepStrictEqual(chamadas[0][3].especial.corpo, { name: 'Loja', address: '', latitude: -1.45, longitude: -48.5 });
  res = criarRes();
  await c.enviarContato(req({ body: { nome: 'João', telefone: '123' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.enviarContato(req({ body: { nome: 'João', telefone: '(93) 99999-0000' } }), res);
  assert.strictEqual(chamadas[1][3].especial.endpoint, 'sendContact');
  assert.deepStrictEqual(chamadas[1][3].especial.corpo.contact[0], { fullName: 'João', wuid: '5593999990000', phoneNumber: '+5593999990000' });
});
