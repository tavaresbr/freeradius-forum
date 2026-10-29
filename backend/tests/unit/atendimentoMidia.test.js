// Midia do atendimento WhatsApp: whitelist/assinatura, download no webhook, envio, rota autenticada de leitura.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]);

const limpar = () => {
  for (const f of ['src/services/whatsappAtendimento.js', 'src/controllers/atendimentoController.js', 'src/utils/whatsappMidia.js']) {
    delete require.cache[require.resolve(path.join(ROOT, f))];
  }
};
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
const wpp = () => ({
  getEvolutionConfig: async () => ({ apiUrl: 'http://evo', apiKey: 'k', instanceName: 'empresa_7' }),
  formatarNumeroComNonoDigito: (n) => n,
});
const carregarSvc = (db) => { limpar(); return carregar('src/services/whatsappAtendimento.js', { db, extras: { 'src/controllers/whatsappController.js': wpp() } }); };
const carregarCtrl = (db) => { limpar(); return carregar('src/controllers/atendimentoController.js', { db, extras: { 'src/controllers/whatsappController.js': wpp() } }); };
const util = () => { limpar(); return require(path.join(ROOT, 'src/utils/whatsappMidia.js')); };
// limpa o que os testes gravam em uploads/whatsapp/7
const limparUploads = () => fs.rmSync(path.join(ROOT, 'uploads/whatsapp/7'), { recursive: true, force: true });

test('validarArquivo: whitelist, assinatura e tamanho; SVG/HTML/executavel recusados; extensao vem do tipo', () => {
  const u = util();
  assert.deepStrictEqual({ ...u.validarArquivo(PNG, 'image/png', '../../etc/foto.png') }, { mime: 'image/png', ext: 'png', tipo: 'imagem', nome: 'foto.png' });
  assert.strictEqual(u.validarArquivo(OGG, 'Audio/OGG; codecs=opus', null).tipo, 'audio');
  assert.strictEqual(u.validarArquivo(PDF, 'application/pdf', 'a.pdf').tipo, 'documento');
  for (const mime of ['image/svg+xml', 'text/html', 'application/x-msdownload', 'application/javascript', '']) {
    assert.throws(() => u.validarArquivo(Buffer.from('<svg onload=alert(1)></svg>'), mime, 'x'), /não permitido/);
  }
  assert.throws(() => u.validarArquivo(Buffer.from('<html><script>x</script></html>' + ' '.repeat(40)), 'image/png', 'foto.png'), /não corresponde/);
  assert.throws(() => u.validarArquivo(PDF, 'image/jpeg', 'x.jpg'), /não corresponde/);
  assert.throws(() => u.validarArquivo(Buffer.alloc(16 * 1024 * 1024 + 1, 1), 'text/plain', 'g.txt'), (e) => e.status === 413);
  assert.throws(() => u.validarArquivo(Buffer.alloc(0), 'image/png', 'v.png'), /vazio/);
});

test('caminhoAbsoluto: nunca sai da pasta de midia', () => {
  const u = util();
  assert.ok(u.caminhoAbsoluto('7/2026-10/a.png').startsWith(u.RAIZ_MIDIA));
  for (const ruim of ['../server.js', '7/../../../etc/passwd', '/etc/passwd', '', null, '..', 'a\0b']) assert.strictEqual(u.caminhoAbsoluto(ruim), null);
});

test('webhook com imagem: grava a mensagem com o tipo e baixa o arquivo (extensao pela whitelist)', async () => {
  const postOrig = axios.post;
  const db = criarDb((sql) => {
    if (/SELECT id FROM whatsapp_conversas/.test(sql)) return [[{ id: 5 }]];
    if (/INSERT IGNORE INTO whatsapp_mensagens/.test(sql)) return [{ affectedRows: 1, insertId: 33 }];
  });
  try {
    let url;
    axios.post = async (u) => { url = u; return { data: { base64: 'data:image/png;base64,' + PNG.toString('base64'), mimetype: 'image/png' } }; };
    await carregarSvc(db).processarWebhook(7, {
      event: 'messages.upsert',
      data: { key: { remoteJid: '5593999990000@s.whatsapp.net', fromMe: false, id: 'IMG1' }, message: { imageMessage: { mimetype: 'image/png', caption: 'foto' } } },
    });
    const ins = db.calls.find((c) => /INSERT IGNORE INTO whatsapp_mensagens/.test(c.sql));
    assert.strictEqual(ins.params[4], 'imagem');
    assert.strictEqual(ins.params[8], 'image/png');
    assert.strictEqual(url, 'http://evo/chat/getBase64FromMediaMessage/empresa_7');
    const upd = db.calls.find((c) => /SET midia_path = \?/.test(c.sql));
    assert.match(upd.params[0], /^7\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.deepStrictEqual(upd.params.slice(2), [33, 7]);
    assert.ok(fs.existsSync(path.join(ROOT, 'uploads/whatsapp', upd.params[0])));
  } finally { axios.post = postOrig; limparUploads(); }
});

test('webhook: falha no download nao perde a mensagem; tipo nao aceito nem tenta baixar', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  const db = criarDb((sql) => {
    if (/SELECT id FROM whatsapp_conversas/.test(sql)) return [[{ id: 5 }]];
    if (/INSERT IGNORE INTO whatsapp_mensagens/.test(sql)) return [{ affectedRows: 1, insertId: 34 }];
  });
  try {
    let chamadas = 0;
    axios.post = async () => { chamadas++; throw new Error('Evolution fora do ar'); };
    const svc = carregarSvc(db);
    await svc.processarWebhook(7, { event: 'messages.upsert', data: { key: { remoteJid: '5593999990000@s.whatsapp.net', id: 'A1' }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } } });
    assert.strictEqual(chamadas, 1);
    assert.ok(db.calls.some((c) => /UPDATE whatsapp_conversas SET ultima_msg_em/.test(c.sql)), 'conversa atualizada mesmo sem a midia');
    assert.ok(!db.calls.some((c) => /SET midia_path/.test(c.sql)));
    await svc.processarWebhook(7, { event: 'messages.upsert', data: { key: { remoteJid: '5593999990000@s.whatsapp.net', id: 'A2' }, message: { imageMessage: { mimetype: 'image/svg+xml' } } } });
    assert.strictEqual(chamadas, 1, 'svg nao baixa');
    const ins = db.calls.filter((c) => /INSERT IGNORE INTO whatsapp_mensagens/.test(c.sql)).pop();
    assert.strictEqual(ins.params[8], null);
  } finally { axios.post = postOrig; fim(); }
});

test('download com conteudo que nao confere com o tipo e descartado', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  const db = criarDb();
  try {
    axios.post = async () => ({ data: { base64: Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40)).toString('base64'), mimetype: 'image/png' } });
    await assert.rejects(carregarSvc(db).baixarMidia(7, { id: 1, wa_id: 'X', midia_mime: 'image/png' }), /não corresponde/);
    assert.ok(!db.calls.some((c) => /SET midia_path/.test(c.sql)));
  } finally { axios.post = postOrig; fim(); }
});

test('envio de midia: imagem vai por sendMedia, audio por sendWhatsAppAudio; arquivo e legenda gravados', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  const conversa = { id: 5, jid: '5593999990000@s.whatsapp.net', telefone: '5593999990000' };
  try {
    const db = criarDb((sql) => (/INSERT INTO whatsapp_mensagens/.test(sql) ? [{ insertId: 70 }] : undefined));
    const chamadas = [];
    axios.post = async (url, body) => { chamadas.push({ url, body }); return { data: { key: { id: 'W' + chamadas.length } } }; };
    const svc = carregarSvc(db);
    await svc.enviarMensagem(7, 3, conversa, { tipo: 'imagem', texto: 'veja', midia: { buffer: PNG, mime: 'image/png', ext: 'png', nome: 'foto.png' } });
    await svc.enviarMensagem(7, 3, conversa, { tipo: 'audio', texto: '', midia: { buffer: OGG, mime: 'audio/ogg', ext: 'ogg', nome: null } });
    assert.strictEqual(chamadas[0].url, 'http://evo/message/sendMedia/empresa_7');
    assert.deepStrictEqual({ ...chamadas[0].body, media: undefined }, { number: '5593999990000', mediatype: 'image', mimetype: 'image/png', caption: 'veja', media: undefined, fileName: 'foto.png' });
    assert.strictEqual(chamadas[0].body.media, PNG.toString('base64'));
    assert.strictEqual(chamadas[1].url, 'http://evo/message/sendWhatsAppAudio/empresa_7');
    assert.strictEqual(chamadas[1].body.audio, OGG.toString('base64'));
    assert.strictEqual(chamadas[1].body.encoding, true); // a Evolution converte para nota de voz (OGG/Opus)
    const ins = db.calls.filter((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql));
    assert.strictEqual(ins[0].params[3], 'imagem');
    assert.match(ins[0].params[5], /^7\/.*\.png$/);
    assert.strictEqual(ins[0].params[6], 'image/png');
    assert.ok(db.calls.some((c) => /ultima_msg_previa/.test(c.sql) && c.params[0] === '🎤 Áudio'));
  } finally { axios.post = postOrig; fim(); limparUploads(); }
});

test('controller enviarMidia: sem arquivo 400, SVG recusado, conversa de outra empresa 404', async () => {
  const fim = semLog();
  try {
    const db = criarDb((sql, p) => (/SELECT \* FROM whatsapp_conversas/.test(sql) ? (p[1] === 7 ? [[{ id: 5, jid: 'x', telefone: '5593999990000' }]] : [[]]) : undefined));
    const c = carregarCtrl(db);
    let res = criarRes();
    await c.enviarMidia(criarReq({ params: { id: '5' }, empresa_id: 7, user: { id: 1 }, body: {} }), res);
    assert.strictEqual(res.statusCode, 400);
    res = criarRes();
    await c.enviarMidia(criarReq({ params: { id: '5' }, empresa_id: 7, user: { id: 1 }, body: {}, file: { buffer: Buffer.from('<svg onload=alert(1)></svg>'), mimetype: 'image/svg+xml', originalname: 'a.svg' } }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(!db.calls.some((x) => /INSERT INTO whatsapp_mensagens/.test(x.sql)));
    res = criarRes();
    await c.enviarMidia(criarReq({ params: { id: '5' }, empresa_id: 8, user: { id: 1 }, body: {}, file: { buffer: PNG, mimetype: 'image/png', originalname: 'a.png' } }), res);
    assert.strictEqual(res.statusCode, 404);
  } finally { fim(); }
});

test('rota de midia: escopada por empresa, imagem inline, PDF como attachment, path traversal 404', async () => {
  const fim = semLog();
  try {
    const u = util();
    const relImg = await u.salvarArquivo(7, PNG, 'png');
    const relPdf = await u.salvarArquivo(7, PDF, 'pdf');
    const linhas = {
      1: { id: 1, wa_id: 'a', direcao: 'in', midia_path: relImg, midia_mime: 'image/png', midia_nome: 'foto.png' },
      2: { id: 2, wa_id: 'b', direcao: 'in', midia_path: relPdf, midia_mime: 'application/pdf', midia_nome: 'Contrato final.pdf' },
      3: { id: 3, wa_id: 'c', direcao: 'out', midia_path: '../../server.js', midia_mime: 'image/png', midia_nome: 'x.png' },
    };
    const db = criarDb((sql, p) => (/FROM whatsapp_mensagens WHERE id = \? AND empresa_id = \?/.test(sql) && p[1] === 7 && linhas[p[0]] ? [[linhas[p[0]]]] : [[]]));
    const c = carregarCtrl(db);
    let res = criarRes();
    await c.servirMidia(criarReq({ params: { id: '1' }, empresa_id: 7 }), res);
    assert.strictEqual(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Content-Disposition'], /^inline/);
    assert.strictEqual(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.deepStrictEqual(res.body, PNG);
    res = criarRes();
    await c.servirMidia(criarReq({ params: { id: '2' }, empresa_id: 7 }), res);
    assert.match(res.headers['Content-Disposition'], /^attachment; filename\*=UTF-8''Contrato%20final\.pdf$/);
    res = criarRes();
    await c.servirMidia(criarReq({ params: { id: '3' }, empresa_id: 7 }), res);
    assert.strictEqual(res.statusCode, 404);
    res = criarRes();
    await c.servirMidia(criarReq({ params: { id: '1' }, empresa_id: 8 }), res);
    assert.strictEqual(res.statusCode, 404);
    assert.ok(db.calls.every((x) => /empresa_id = \?/.test(x.sql)));
  } finally { fim(); limparUploads(); }
});

test('rota de midia: mensagem recebida sem arquivo tenta baixar uma vez; falha = 502', async () => {
  const fim = semLog();
  const postOrig = axios.post;
  try {
    const db = criarDb((sql) => (/FROM whatsapp_mensagens WHERE id/.test(sql) ? [[{ id: 9, wa_id: 'z', direcao: 'in', midia_path: null, midia_mime: 'image/png', midia_nome: null }]] : undefined));
    axios.post = async () => { throw new Error('fora do ar'); };
    const res = criarRes();
    await carregarCtrl(db).servirMidia(criarReq({ params: { id: '9' }, empresa_id: 7 }), res);
    assert.strictEqual(res.statusCode, 502);
  } finally { axios.post = postOrig; fim(); }
});

test('audio gravado no navegador (webm/opus): aceito com assinatura EBML; sem ela ou como video/webm, recusado', () => {
  const u = util();
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 1)]);
  const r = u.validarArquivo(WEBM, 'audio/webm;codecs=opus', 'audio-1.webm');
  assert.deepStrictEqual({ mime: r.mime, ext: r.ext, tipo: r.tipo }, { mime: 'audio/webm', ext: 'webm', tipo: 'audio' });
  assert.throws(() => u.validarArquivo(Buffer.alloc(40, 1), 'audio/webm', 'x.webm'), /não corresponde/);
  assert.throws(() => u.validarArquivo(WEBM, 'video/webm', 'x.webm'), /não permitido/);
});
