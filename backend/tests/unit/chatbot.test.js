// Chatbot de menu do atendimento WhatsApp: config, interpretacao, regras de nao responder e execucao das opcoes.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const bot = require('../../src/utils/chatbot');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/services/whatsappChatbot.js', 'src/controllers/atendimentoAutomacaoController.js', 'src/utils/schemaCache.js', 'src/services/whatsappAutomacao.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);

test('validarChatbot: teclas 1-9 unicas, tipos validos, texto obrigatorio no tipo texto, ativo exige menu e opcao', () => {
  const ok = bot.validarChatbot({ ativo: true, mensagem_menu: 'Oi', opcoes: [{ tecla: '2', rotulo: 'Planos', tipo: 'planos' }, { tecla: '1', rotulo: 'Saldo', tipo: 'saldo' }] });
  assert.deepStrictEqual(ok.opcoes.map((o) => o.tecla), ['1', '2']);
  assert.throws(() => bot.validarChatbot({ ativo: true, mensagem_menu: 'x', opcoes: [{ tecla: '0', rotulo: 'a', tipo: 'saldo' }] }), /1 a 9/);
  assert.throws(() => bot.validarChatbot({ mensagem_menu: 'x', opcoes: [{ tecla: '1', rotulo: 'a', tipo: 'saldo' }, { tecla: '1', rotulo: 'b', tipo: 'planos' }] }), /repetida/);
  assert.throws(() => bot.validarChatbot({ opcoes: [{ tecla: '1', rotulo: 'a', tipo: 'hack' }] }), /Tipo/);
  assert.throws(() => bot.validarChatbot({ opcoes: [{ tecla: '1', rotulo: 'a', tipo: 'texto', texto: '' }] }), /texto da resposta/);
  assert.throws(() => bot.validarChatbot({ opcoes: [{ tecla: '1', rotulo: '', tipo: 'saldo' }] }), /precisa de um nome/);
  assert.throws(() => bot.validarChatbot({ ativo: true, mensagem_menu: 'x', opcoes: [] }), /ao menos uma opção/);
  assert.throws(() => bot.validarChatbot({ ativo: true, mensagem_menu: '', opcoes: [{ tecla: '1', rotulo: 'a', tipo: 'saldo' }] }), /mensagem do menu/);
  assert.throws(() => bot.validarChatbot({ opcoes: Array.from({ length: 10 }, (_, i) => ({ tecla: String(i % 9 + 1), rotulo: 'a', tipo: 'saldo' })) }), /Máximo de 9/);
  assert.strictEqual(bot.validarChatbot({ ativo: false, opcoes: [] }).ativo, false);
});

test('montarMenu e interpretar', () => {
  const cfg = { ...bot.padrao(), ativo: true };
  assert.match(bot.montarMenu(cfg, 'Maria Souza'), /^Olá Maria! Como posso ajudar\?\n\n1 - Ver meu tempo restante\n2 - Ver os planos\n3 - Falar com um atendente\n\nResponda com o número da opção\.$/);
  assert.match(bot.montarMenu(cfg, ''), /^Olá! Como/);
  assert.strictEqual(bot.interpretar(' 2 ', cfg).opcao.tipo, 'planos');
  assert.strictEqual(bot.interpretar('Menu!', cfg).tipo, 'menu');
  assert.strictEqual(bot.interpretar('MENU', cfg).tipo, 'menu');
  assert.strictEqual(bot.interpretar('9', cfg).tipo, 'livre'); // tecla sem opcao
  assert.strictEqual(bot.interpretar('quero o 2 por favor', cfg).tipo, 'livre');
});

// ---------- servico ----------
const AGORA = new Date('2026-10-29T15:00:00Z');
const montar = ({ cfg, conv = {}, colunas = true, recurso = true, humano = 0, optout = false, claim = 1, saldo = { existe: true, temSaldo: true, tempoRestante: 1500 }, link = 'https://portal.exemplo.com/planos-cliente?x=1' } = {}) => {
  limpar();
  const enviados = [];
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ chatbot: cfg }) }]];
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[{ id: 5, nome: 'Maria Souza', telefone: '5593999990000', lead_id: 9, atendente_id: null, chatbot_estado: null, chatbot_em: null, ...conv }]];
    if (/direcao = 'out'/.test(sql)) return [[{ n: humano }]];
    if (/FROM leads WHERE empresa_id = \? AND whatsapp_optout/.test(sql)) return [optout ? [{ id: 9 }] : []];
    if (/SELECT id, cpf FROM leads/.test(sql)) return [[{ id: 9, cpf: '123.456.789-09' }]];
    if (/SET chatbot_estado = 'menu', chatbot_em = NOW\(\)\s+WHERE/.test(sql)) return [{ affectedRows: claim }];
    if (/SELECT nas_id FROM radius_users/.test(sql)) return [[{ nas_id: 3 }]];
  });
  const mod = carregar('src/services/whatsappChatbot.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/utils/telefoneBusca.js': { exprTelefoneFim10: async () => 'RIGHT(telefone, 10)' },
      'src/utils/leadUtils.js': { verificarSaldoRadius: async (u) => (u === '12345678909' ? saldo : { existe: false }) },
      'src/utils/linkPlanos.js': { linkPlanosDoCliente: async () => link },
      'src/services/whatsappAtendimento.js': { enviarTexto: async (...a) => { enviados.push(a); } },
    },
  });
  return { mod, db, enviados };
};
const cfgOn = { ...bot.padrao(), ativo: true };
const msg = (texto, over = {}) => ({ fromMe: false, tipo: 'texto', texto, ...over });

test('chatbot: 1a mensagem manda o menu (marcado automatico) e reserva a janela de forma atomica', async () => {
  const { mod, enviados, db } = montar({ cfg: cfgOn });
  const r = await mod.processar(7, 5, msg('oi'), AGORA);
  assert.deepStrictEqual([r.tratada, r.motivo], [true, 'menu']);
  assert.match(enviados[0][3], /1 - Ver meu tempo restante/);
  assert.deepStrictEqual(enviados[0][4], { automatica: true });
  const claim = db.calls.find((c) => /SET chatbot_estado = 'menu'/.test(c.sql));
  assert.match(claim.sql, /empresa_id = \? AND \(chatbot_em IS NULL OR chatbot_em < DATE_SUB/);
  assert.deepStrictEqual(claim.params, [5, 7]);
  // janela ja usada por outra mensagem quase simultanea = nao repete
  const dup = montar({ cfg: cfgOn, claim: 0 });
  const r2 = await dup.mod.processar(7, 5, msg('oi'), AGORA);
  assert.strictEqual(r2.tratada, false);
  assert.strictEqual(dup.enviados.length, 0);
});

test('chatbot: opcao 1 mostra o tempo restante SEM CPF; sem cadastro avisa; tempo acabado orienta', async () => {
  const menuRecente = { chatbot_estado: 'menu', chatbot_em: new Date(AGORA.getTime() - 60000) };
  let t = montar({ cfg: cfgOn, conv: menuRecente });
  let r = await t.mod.processar(7, 5, msg('1'), AGORA);
  assert.strictEqual(r.motivo, 'opcao_saldo');
  assert.match(t.enviados[0][3], /^Você ainda tem cerca de 25 minutos de internet\.\n\nDigite \*menu\*/);
  assert.doesNotMatch(t.enviados[0][3], /123|456|789/);
  t = montar({ cfg: cfgOn, conv: { ...menuRecente, lead_id: null } });
  await t.mod.processar(7, 5, msg('1'), AGORA);
  assert.match(t.enviados[0][3], /Não encontrei um cadastro/);
  t = montar({ cfg: cfgOn, conv: menuRecente, saldo: { existe: true, temSaldo: false, tempoRestante: 0 } });
  await t.mod.processar(7, 5, msg('1'), AGORA);
  assert.match(t.enviados[0][3], /tempo de internet acabou/);
});

test('chatbot: opcao planos manda o link; opcao texto manda o texto fixo; opcao digitada sem menu recente reenvia o menu', async () => {
  const menuRecente = { chatbot_estado: 'menu', chatbot_em: new Date(AGORA.getTime() - 60000) };
  let t = montar({ cfg: cfgOn, conv: menuRecente });
  await t.mod.processar(7, 5, msg('2'), AGORA);
  assert.match(t.enviados[0][3], /^Escolha o seu plano por aqui: https:\/\/portal\.exemplo\.com/);
  const cfgTexto = { ...cfgOn, opcoes: [{ tecla: '1', rotulo: 'Horário', tipo: 'texto', texto: 'Atendemos das 8h às 18h.' }] };
  t = montar({ cfg: cfgTexto, conv: menuRecente });
  await t.mod.processar(7, 5, msg('1'), AGORA);
  assert.match(t.enviados[0][3], /^Atendemos das 8h às 18h\./);
  // "2" digitado a frio (menu de 2 h atras): 12 h ainda nao passaram => nao reenvia, deixa para a equipe
  t = montar({ cfg: cfgOn, conv: { chatbot_estado: 'menu', chatbot_em: new Date(AGORA.getTime() - 2 * 3600000) }, claim: 0 });
  const r = await t.mod.processar(7, 5, msg('2'), AGORA);
  assert.strictEqual(r.tratada, false);
  assert.strictEqual(t.enviados.length, 0);
});

test('chatbot: opcao atendente entrega ao humano (estado, nota interna, conversa aberta) e para de responder por 12 h', async () => {
  const menuRecente = { chatbot_estado: 'menu', chatbot_em: new Date(AGORA.getTime() - 60000) };
  const t = montar({ cfg: cfgOn, conv: menuRecente });
  const r = await t.mod.processar(7, 5, msg('3'), AGORA);
  assert.strictEqual(r.motivo, 'opcao_atendente');
  assert.match(t.enviados[0][3], /atendente vai responder/);
  assert.ok(t.db.calls.some((c) => /chatbot_estado = 'humano'/.test(c.sql) && /status = 'aberta'/.test(c.sql) && c.params.includes(7)));
  const nota = t.db.calls.find((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql));
  assert.match(nota.params[3], /pediu para falar com um atendente/);
  // depois disso, qualquer mensagem e' ignorada pelo bot (e a resposta automatica tambem nao dispara)
  const depois = montar({ cfg: cfgOn, conv: { chatbot_estado: 'humano', chatbot_em: new Date(AGORA.getTime() - 3600000) } });
  const r2 = await depois.mod.processar(7, 5, msg('menu'), AGORA);
  assert.deepStrictEqual([r2.tratada, r2.motivo], [true, 'humano']);
  assert.strictEqual(depois.enviados.length, 0);
  // passadas 12 h volta a funcionar
  const volta = montar({ cfg: cfgOn, conv: { chatbot_estado: 'humano', chatbot_em: new Date(AGORA.getTime() - 13 * 3600000) } });
  assert.strictEqual((await volta.mod.processar(7, 5, msg('menu'), AGORA)).tratada, true);
});

test('chatbot: nunca responde desligado, sem recurso/migration, fromMe, midia, SAIR, opt-out, atendente ou equipe ja respondendo', async () => {
  const casos = [
    [{ cfg: { ...cfgOn, ativo: false } }, msg('oi'), 'desligado'],
    [{ cfg: cfgOn, recurso: false }, msg('oi'), 'sem_recurso'],
    [{ cfg: cfgOn, colunas: false }, msg('oi'), 'sem_migration'],
    [{ cfg: cfgOn }, msg('oi', { fromMe: true }), 'ignorada'],
    [{ cfg: cfgOn }, msg('oi', { tipo: 'imagem' }), 'ignorada'],
    [{ cfg: cfgOn }, msg(' sair '), 'sair'],
    [{ cfg: cfgOn, optout: true }, msg('oi'), 'optout'],
    [{ cfg: cfgOn, conv: { atendente_id: 3 } }, msg('oi'), 'com_atendente'],
    [{ cfg: cfgOn, humano: 2 }, msg('oi'), 'equipe_respondeu'],
  ];
  for (const [opts, m, motivo] of casos) {
    const t = montar(opts);
    const r = await t.mod.processar(7, 5, m, AGORA);
    assert.deepStrictEqual([r.tratada, r.motivo], [false, motivo]);
    assert.strictEqual(t.enviados.length, 0, motivo);
  }
});

// ---------- controller ----------
test('controller: salvar valida e preserva o resto da config; ativar sem a migration 058 = 503', async () => {
  limpar();
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: '{"api_key":"k","automacao":{"ativo":true}}' }]];
    if (/SELECT id FROM empresa_configs/.test(sql)) return [[{ id: 1 }]];
  });
  const c = carregar('src/controllers/atendimentoAutomacaoController.js', { db, extras: { 'src/controllers/whatsappController.js': {} } });
  const rq = (body) => criarReq({ empresa_id: 7, user: { id: 3 }, params: {}, body });
  let res = criarRes();
  await c.salvarChatbot(rq({ ativo: true, mensagem_menu: 'Oi', opcoes: [{ tecla: '1', rotulo: 'Planos', tipo: 'planos' }] }), res);
  assert.strictEqual(res.body.success, true);
  const salvo = JSON.parse(db.calls.find((x) => /UPDATE empresa_configs SET config_json/.test(x.sql)).params[0]);
  assert.strictEqual(salvo.api_key, 'k');
  assert.strictEqual(salvo.automacao.ativo, true);
  assert.strictEqual(salvo.chatbot.opcoes[0].tipo, 'planos');
  res = criarRes();
  await c.salvarChatbot(rq({ ativo: true, mensagem_menu: 'Oi', opcoes: [] }), res);
  assert.strictEqual(res.statusCode, 400);

  limpar();
  const db2 = criarDb((sql) => (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) ? [[{ n: 0 }]] : undefined));
  const c2 = carregar('src/controllers/atendimentoAutomacaoController.js', { db: db2, extras: { 'src/controllers/whatsappController.js': {} } });
  res = criarRes();
  await c2.salvarChatbot(rq({ ativo: true, mensagem_menu: 'Oi', opcoes: [{ tecla: '1', rotulo: 'a', tipo: 'planos' }] }), res);
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.error, /migration 058/);
});
