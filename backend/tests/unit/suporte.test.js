// Balao de suporte: validacao da config e endpoint publico (so dados de exibicao).
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const u = require('../../src/utils/suporte');

test('telefone e validarConfig', () => {
  assert.strictEqual(u.telefoneSuporte('(11) 99999-0000'), '5511999990000');
  assert.strictEqual(u.telefoneSuporte('123'), null);
  assert.strictEqual(u.numeroDoJid('5511999990000@s.whatsapp.net'), '5511999990000');
  assert.ok(u.validarConfig({ telefone: 'abc' }).erro);
  assert.ok(u.validarConfig({ mensagem: 'x'.repeat(301) }).erro);
  const ok = u.validarConfig({ ativo: false, telefone: '', mensagem: ' oi ' });
  assert.deepStrictEqual(ok.config, { ativo: false, telefone: '', mensagem: 'oi', modo: 'chat' });
  assert.strictEqual(u.validarConfig({}).config.mensagem, u.MSG_PADRAO);
});

test('publico: usa o telefone da config; sem ele, o numero conectado; desligado ou sem numero = inativo', async () => {
  const mk = (cfg, instancias) => {
    const db = criarDb(async (sql) => {
      if (/plataforma_configs/.test(sql)) return [cfg ? [{ config_json: JSON.stringify(cfg) }] : []];
      if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ api_url: 'http://evo', api_key: 'k', instance_name: 'empresa_1' }) }]];
    });
    const orig = axios.get;
    axios.get = async () => ({ data: instancias });
    return { c: carregar('src/controllers/suporteController.js', { db }), volta: () => { axios.get = orig; } };
  };
  let t = mk({ ativo: true, telefone: '11988887777', mensagem: 'Oi', modo: 'whatsapp' }, []);
  let res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.deepStrictEqual(res.body, { ativo: true, modo: 'whatsapp', whatsapp: '5511988887777', mensagem: 'Oi' });
  t = mk({ modo: 'whatsapp' }, [{ name: 'empresa_1', ownerJid: '5511977776666@s.whatsapp.net' }]);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.whatsapp, '5511977776666'); assert.strictEqual(res.body.ativo, true);
  t = mk({ ativo: false, telefone: '11988887777', modo: 'whatsapp' }, []);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.ativo, false); assert.strictEqual(res.body.whatsapp, null);
  t = mk({ modo: 'whatsapp' }, []);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.ativo, false);
});

// ---- Chat dentro do sistema ----
const { jidChatPainel, ehChatPainel, textoChat } = require('../../src/utils/suporte');

test('chat: jid proprio, texto validado e modo padrao = chat', () => {
  assert.strictEqual(jidChatPainel(7), 'painel_7@suporte.painel');
  assert.ok(ehChatPainel('painel_7@suporte.painel'));
  assert.ok(!ehChatPainel('5511999990000@s.whatsapp.net'));
  assert.strictEqual(textoChat('  oi  '), 'oi');
  assert.strictEqual(textoChat(''), null);
  assert.strictEqual(textoChat('x'.repeat(1001)), null);
  assert.strictEqual(u.validarConfig({}).config.modo, 'chat');
  assert.strictEqual(u.validarConfig({ modo: 'whatsapp' }).config.modo, 'whatsapp');
});

test('chat: cliente escreve na conversa da PLATAFORMA (escopo da propria empresa) e so le a propria conversa', async () => {
  process.env.SITE_EMPRESA_ID = '1';
  const db = criarDb(async (sql, p) => {
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Provedor X' }]];
    if (/INSERT INTO whatsapp_conversas/.test(sql)) return [{ insertId: 50 }];
    if (/INSERT INTO whatsapp_mensagens/.test(sql)) return [{ insertId: 900 }];
    if (/SELECT id FROM whatsapp_conversas/.test(sql)) return [[{ id: 50 }]];
    if (/FROM whatsapp_mensagens m/.test(sql)) return [[{ id: 901, direcao: 'out', texto: 'Oi!', criado_em: new Date(), autor: 'Ana' }, { id: 900, direcao: 'in', texto: 'Ajuda', criado_em: new Date(), autor: null }]];
  });
  const c = carregar('src/controllers/suporteChatController.js', { db });
  let res = criarRes();
  await c.enviar(criarReq({ empresa_id: 7, body: { texto: 'Ajuda' } }), res);
  assert.strictEqual(res.statusCode, 201);
  const ins = db.calls.find((x) => /INSERT INTO whatsapp_conversas/.test(x.sql));
  assert.strictEqual(ins.params[0], 1);                       // conversa na empresa da plataforma
  assert.strictEqual(ins.params[1], 'painel_7@suporte.painel'); // jid da empresa 7 (vem do token, nao do corpo)
  assert.ok(db.calls.some((x) => /nao_lidas = nao_lidas \+ 1/.test(x.sql)));
  res = criarRes();
  await c.enviar(criarReq({ empresa_id: 7, body: { texto: '' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.enviar(criarReq({ empresa_id: 1, body: { texto: 'oi' } }), res);   // a propria plataforma nao usa o balao
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.listar(criarReq({ empresa_id: 7, query: {} }), res);
  assert.deepStrictEqual(res.body.mensagens.map((m) => m.de), ['cliente', 'suporte']);
  assert.ok(!JSON.stringify(res.body).includes('Ana'));        // nome de quem atende nao vaza
  const sel = db.calls.filter((x) => /FROM whatsapp_mensagens m/.test(x.sql)).pop();
  assert.ok(sel.params.includes(50));
});

test('resposta da equipe a conversa do painel fica so no sistema (nada vai a Evolution)', async () => {
  let chamouEvolution = false;
  const orig = axios.post; axios.post = async () => { chamouEvolution = true; return { data: {} }; };
  try {
    const db = criarDb(async (sql) => { if (/INSERT INTO whatsapp_mensagens/.test(sql)) return [{ insertId: 7 }]; });
    const svc = carregar('src/services/whatsappAtendimento.js', { db });
    const r = await svc.enviarTexto(1, 3, { id: 50, jid: 'painel_7@suporte.painel', numero_id: 0 }, 'Olá, tudo bem?');
    assert.strictEqual(r.id, 7);
    assert.strictEqual(chamouEvolution, false);
    await assert.rejects(() => svc.enviarMensagem(1, 3, { id: 50, jid: 'painel_7@suporte.painel', numero_id: 0 }, { tipo: 'imagem', midia: { buffer: Buffer.from('x'), ext: 'png', mime: 'image/png' } }), (e) => e.status === 400);
  } finally { axios.post = orig; }
});

test('publico: modo chat fica ativo mesmo sem numero de WhatsApp', async () => {
  const db = criarDb(async (sql) => {
    if (/plataforma_configs/.test(sql)) return [[{ config_json: JSON.stringify({ ativo: true, modo: 'chat' }) }]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ api_url: 'http://evo', api_key: 'k', instance_name: 'e' }) }]];
  });
  const orig = axios.get; axios.get = async () => ({ data: [] });
  try {
    const c = carregar('src/controllers/suporteController.js', { db });
    const res = criarRes(); await c.publico(criarReq(), res);
    assert.strictEqual(res.body.ativo, true); assert.strictEqual(res.body.modo, 'chat'); assert.strictEqual(res.body.whatsapp, null);
  } finally { axios.get = orig; }
});
