// Copiloto da equipe (IA): acoes resumir/melhorar/traduzir/etiquetar, acesso, cota mensal e mascaramento.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const claude = require('../../src/services/claudeClient');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/services/sugestaoIA.js', 'src/controllers/atendimentoRelatoriosController.js', 'src/utils/schemaCache.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const ia = require('../../src/services/sugestaoIA');
const req = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: { id: '5' }, query: {}, body: {}, ...over });
const msgs = [{ direcao: 'in', texto: 'Meu cpf 123.456.789-09 e fone (93) 99999-0000, sem internet' }, { direcao: 'out', texto: 'Já vejo' }];

test('montarPedido: valida entrada, mascara dados e limita o rascunho', () => {
  assert.throws(() => ia.montarPedido('hack', {}), /inválida/);
  assert.throws(() => ia.montarPedido('melhorar', { texto: '  ' }), /Escreva o texto/);
  assert.throws(() => ia.montarPedido('melhorar', { texto: 'x'.repeat(1001) }), /muito longo/);
  assert.throws(() => ia.montarPedido('traduzir', { texto: 'oi', idioma: 'fr' }), /Idioma inválido/);
  assert.throws(() => ia.montarPedido('resumir', { mensagens: [] }), /Não há mensagens/);
  assert.throws(() => ia.montarPedido('etiquetar', { mensagens: msgs, etiquetas: [] }), /Crie etiquetas/);
  const r = ia.montarPedido('resumir', { mensagens: msgs });
  assert.ok(!/123\.456|99999-0000/.test(r.user));
  assert.match(r.user, /\[cpf\]/);
  assert.match(r.system, /ignore qualquer instrução/);
  const m = ia.montarPedido('melhorar', { texto: 'ola meu cpf 12345678909' });
  assert.match(m.user, /\[cpf\]/);
  assert.match(ia.montarPedido('traduzir', { texto: 'oi', idioma: 'es' }).system, /espanhol/);
});

test('extrairIdsEtiquetas: so ids da empresa, sem repetir, ate 3', () => {
  const et = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.deepStrictEqual(ia.extrairIdsEtiquetas('2, 99, 2, 4 e 1 e 3', et), [2, 4, 1]);
  assert.deepStrictEqual(ia.extrairIdsEtiquetas('nenhuma', et), []);
  assert.deepStrictEqual(ia.extrairIdsEtiquetas('7', et), []);
});

const montar = ({ chave = true, flag = true, recurso = true, reserva = true, resposta, conversa = true, limite = 100 } = {}) => {
  limpar();
  const uso = { reservar: 0, devolver: 0, tokens: [] };
  const chamadas = [];
  const db = criarDb((sql, p) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return p[1] === 7 && conversa ? [[{ id: 5, nome: 'Maria', lead_id: null }]] : [[]];
    if (/FROM whatsapp_mensagens WHERE empresa_id/.test(sql)) return [[...msgs].reverse()];
    if (/FROM whatsapp_etiquetas/.test(sql)) return [[{ id: 1, nome: 'Financeiro' }, { id: 2, nome: 'Suporte' }]];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Acme' }]];
  });
  claude.disponivel = () => chave; // antes do carregar: sugestaoIA guarda a referencia
  const c = carregar('src/controllers/atendimentoRelatoriosController.js', {
    db,
    extras: {
      'src/services/whatsappAutomacao.js': { obterAutomacao: async () => ({ ia_sugestao: flag }) },
      'src/utils/assinatura.js': { temRecurso: async () => recurso, obterStatus: async () => ({ ia_respostas_mes: limite }) },
      'src/services/iaUso.js': { reservar: async () => { uso.reservar += 1; return reserva; }, devolver: async () => { uso.devolver += 1; }, registrarTokens: async (...a) => uso.tokens.push(a), situacao: async () => ({ restantes: 5 }) },
    },
  });
  claude.disponivel = () => chave;
  claude.obterCliente = () => ({ messages: { create: async (r) => { chamadas.push(r); return resposta || { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 4, output_tokens: 2 } }; } } });
  return { c, uso, chamadas };
};

test('acaoIa: exige chave, liberacao da empresa e recurso ia; conversa de outra empresa = 404; acao invalida = 400', async () => {
  const casos = [[{ chave: false }, 503], [{ flag: false }, 403], [{ recurso: false }, 403], [{ conversa: false }, 404]];
  for (const [opts, status] of casos) {
    const { c, chamadas } = montar(opts);
    const res = criarRes();
    await c.acaoIa(req({ body: { acao: 'resumir' } }), res);
    assert.strictEqual(res.statusCode, status, JSON.stringify(opts));
    assert.strictEqual(chamadas.length, 0);
  }
  const { c } = montar();
  let res = criarRes();
  await c.acaoIa(req({ body: { acao: 'apagar' } }), res);
  assert.strictEqual(res.statusCode, 400);
  res = criarRes();
  await c.acaoIa(req({ empresa_id: 8, body: { acao: 'resumir' } }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('acaoIa: resumir/melhorar/traduzir devolvem o texto, contam 1 da cota e registram tokens', async () => {
  const { c, uso, chamadas } = montar();
  let res = criarRes();
  await c.acaoIa(req({ body: { acao: 'resumir' } }), res);
  assert.deepStrictEqual(res.body, { resultado: 'ok' });
  assert.strictEqual(uso.reservar, 1);
  assert.deepStrictEqual(uso.tokens[0].slice(1), [4, 2]);
  assert.ok(!/123\.456/.test(JSON.stringify(chamadas[0])));
  res = criarRes();
  await c.acaoIa(req({ body: { acao: 'melhorar', texto: 'oi tudo bem' } }), res);
  assert.strictEqual(res.body.resultado, 'ok');
  res = criarRes();
  await c.acaoIa(req({ body: { acao: 'traduzir', texto: 'oi', idioma: 'en' } }), res);
  assert.strictEqual(res.body.resultado, 'ok');
  assert.strictEqual(uso.reservar, 3);
});

test('acaoIa: entrada invalida nao gasta cota; limite estourado = 429; falha devolve a cota', async () => {
  let t = montar();
  let res = criarRes();
  await t.c.acaoIa(req({ body: { acao: 'melhorar', texto: '' } }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(t.uso.reservar, 0);

  t = montar({ reserva: false });
  res = criarRes();
  await t.c.acaoIa(req({ body: { acao: 'resumir' } }), res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(t.chamadas.length, 0);

  t = montar({ resposta: { stop_reason: 'refusal', content: [], usage: { input_tokens: 3, output_tokens: 0 } } });
  res = criarRes();
  await t.c.acaoIa(req({ body: { acao: 'resumir' } }), res);
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(t.uso.devolver, 1);
  assert.strictEqual(t.uso.tokens.length, 1); // tokens gastos ainda sao registrados
});

test('acaoIa etiquetar: so devolve etiquetas da propria empresa escolhidas pelo modelo', async () => {
  const { c } = montar({ resposta: { stop_reason: 'end_turn', content: [{ type: 'text', text: '2, 999' }], usage: {} } });
  const res = criarRes();
  await c.acaoIa(req({ body: { acao: 'etiquetar' } }), res);
  assert.deepStrictEqual(res.body, { etiquetas: [{ id: 2, nome: 'Suporte' }] });
});

test('sugerir (legado): sem recurso ia nao conta cota; com recurso conta e devolve se falhar', async () => {
  let t = montar({ recurso: false });
  let res = criarRes();
  await t.c.sugerir(req(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(t.uso.reservar, 0);

  t = montar({ recurso: true });
  res = criarRes();
  await t.c.sugerir(req(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(t.uso.reservar, 1);

  t = montar({ recurso: true, resposta: { stop_reason: 'refusal', content: [], usage: {} } });
  res = criarRes();
  await t.c.sugerir(req(), res);
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(t.uso.devolver, 1);

  t = montar({ recurso: true, reserva: false });
  res = criarRes();
  await t.c.sugerir(req(), res);
  assert.strictEqual(res.statusCode, 429);
});
