// Atendimento WhatsApp (relatorios, satisfacao, IA, expurgo de midia, painel "Hoje").
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const axios = require('axios');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const ARQ = ['src/utils/schemaCache.js', 'src/services/whatsappSatisfacao.js', 'src/services/whatsappAutomacao.js', 'src/services/sugestaoIA.js', 'src/controllers/atendimentoRelatoriosController.js', 'src/controllers/dashboardController.js', 'src/jobs/expurgaMidia.js'];
const limpar = () => ARQ.forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
const req = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: {}, query: {}, body: {}, ...over });

// ---------- satisfacao ----------
const montarSat = ({ cfg = { pedir_nota: true, msg_pedir_nota: 'Nota de 1 a 5?' }, claim = 1, optout = false, recurso = true, colunas = true, captura = 1 } = {}) => {
  limpar();
  const enviados = [];
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
    if (/FROM leads WHERE/.test(sql)) return [optout ? [{ id: 1 }] : []];
    if (/SET satisfacao_pedida_em = NOW\(\)/.test(sql)) return [{ affectedRows: claim }];
    if (/SET nota_satisfacao = \?/.test(sql)) return [{ affectedRows: captura }];
  });
  const mod = carregar('src/services/whatsappSatisfacao.js', {
    db,
    extras: {
      'src/utils/assinatura.js': { temRecurso: async () => recurso },
      'src/utils/telefoneBusca.js': { exprTelefoneFim10: async () => 'RIGHT(telefone, 10)' },
      'src/services/whatsappAutomacao.js': { obterAutomacao: async () => cfg },
      'src/services/whatsappAtendimento.js': { enviarTexto: async (...a) => { enviados.push(a); } },
    },
  });
  return { mod, db, enviados };
};
const conv = { id: 5, telefone: '5593999990000', jid: 'x@s.whatsapp.net' };

test('satisfacao: pede a nota ao resolver so se ligado, sem opt-out e 1x a cada 24 h; envia marcado como automatico', async () => {
  let { mod, enviados } = montarSat();
  assert.deepStrictEqual(await mod.pedirNota(7, 3, conv), { enviada: true });
  assert.strictEqual(enviados[0][3], 'Nota de 1 a 5?');
  assert.deepStrictEqual(enviados[0][4], { automatica: true });
  for (const [opts, motivo] of [[{ cfg: { pedir_nota: false } }, 'desligado'], [{ recurso: false }, 'sem_recurso'], [{ optout: true }, 'optout'], [{ claim: 0 }, 'janela'], [{ colunas: false }, 'sem_migration']]) {
    ({ mod, enviados } = montarSat(opts));
    const r = await mod.pedirNota(7, 3, conv);
    assert.deepStrictEqual([r.enviada, r.motivo], [false, motivo]);
    assert.strictEqual(enviados.length, 0);
  }
  ({ mod } = montarSat());
  assert.strictEqual((await mod.pedirNota(7, 3, { id: 5, telefone: null })).motivo, 'sem_telefone');
});

test('satisfacao: so um numero 1-5 conta como nota; sem pedido recente nao captura; texto comum nem consulta o banco', async () => {
  const { mod, db } = montarSat();
  for (const t of ['5', ' 3 ', '4!', '1.']) assert.strictEqual(await mod.capturarNota(7, 5, { tipo: 'texto', texto: t }), true);
  const q = db.calls.find((c) => /SET nota_satisfacao = \?/.test(c.sql));
  assert.match(q.sql, /empresa_id = \? AND nota_satisfacao IS NULL/);
  assert.match(q.sql, /satisfacao_pedida_em >= DATE_SUB\(NOW\(\), INTERVAL 24 HOUR\)/);
  const antes = db.calls.length;
  for (const t of ['6', '0', 'oi', '10', '5 estrelas', '']) assert.strictEqual(await mod.capturarNota(7, 5, { tipo: 'texto', texto: t }), false);
  assert.strictEqual(await mod.capturarNota(7, 5, { tipo: 'texto', texto: '5', fromMe: true }), false);
  assert.strictEqual(await mod.capturarNota(7, 5, { tipo: 'imagem', texto: '5' }), false);
  assert.strictEqual(db.calls.length, antes);
  const sem = montarSat({ captura: 0 });
  assert.strictEqual(await sem.mod.capturarNota(7, 5, { tipo: 'texto', texto: '5' }), false);
});

// ---------- relatorios ----------
test('relatorios: periodo padrao 30 dias, valida datas e limite de 366 dias', () => {
  limpar();
  const c = carregar('src/controllers/atendimentoRelatoriosController.js', { db: criarDb() });
  const p = c.lerPeriodo({});
  assert.match(p.de, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual((new Date(`${p.ate}T00:00:00Z`) - new Date(`${p.de}T00:00:00Z`)) / 86400000, 29);
  assert.throws(() => c.lerPeriodo({ de: '2026-13-40', ate: '2026-10-01' }), /inválidas/);
  assert.throws(() => c.lerPeriodo({ de: 'x', ate: '2026-10-01' }), /inválidas/);
  assert.throws(() => c.lerPeriodo({ de: '2026-10-10', ate: '2026-10-01' }), /depois da inicial/);
  assert.throws(() => c.lerPeriodo({ de: '2024-01-01', ate: '2026-10-01' }), /366/);
});

test('relatorios: agrega tudo escopado por empresa; media, mediana e notas', async () => {
  limpar();
  const db = criarDb((sql) => {
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: 1 }]];
    if (/GROUP BY DATE\(criado_em\)/.test(sql)) return [[{ dia: '2026-10-01', recebidas: '4', enviadas: '3' }]];
    if (/TIMESTAMPDIFF/.test(sql)) return [[{ seg: 60 }, { seg: 120 }, { seg: 600 }]];
    if (/JOIN admins a/.test(sql)) return [[{ nome: 'Ana', enviadas: '3' }]];
    if (/GROUP BY status/.test(sql)) return [[{ status: 'aberta', n: '2' }, { status: 'resolvida', n: '5' }]];
    if (/nota_satisfacao AS nota/.test(sql)) return [[{ nota: 5, n: '3' }, { nota: 4, n: '1' }]];
    if (/COUNT\(\*\) AS n FROM whatsapp_conversas/.test(sql)) return [[{ n: '7' }]];
  });
  const c = carregar('src/controllers/atendimentoRelatoriosController.js', { db });
  const res = criarRes();
  await c.relatorios(req({ query: { de: '2026-10-01', ate: '2026-10-05' } }), res);
  assert.strictEqual(res.body.primeira_resposta.media_seg, 260);
  assert.strictEqual(res.body.primeira_resposta.mediana_seg, 120);
  assert.deepStrictEqual(res.body.conversas, { abertas: 2, resolvidas: 5, novas: 7 });
  assert.strictEqual(res.body.satisfacao.media, 4.75);
  assert.strictEqual(res.body.satisfacao.respostas, 4);
  assert.deepStrictEqual(res.body.por_atendente, [{ nome: 'Ana', enviadas: 3 }]);
  assert.deepStrictEqual(res.body.por_dia, [{ dia: '2026-10-01', recebidas: 4, enviadas: 3 }]);
  const consultas = db.calls.filter((x) => /whatsapp_/.test(x.sql) && !/INFORMATION_SCHEMA/.test(x.sql));
  assert.ok(consultas.length >= 6);
  for (const q of consultas) assert.ok(q.params.includes(7), q.sql); // sempre filtra pela empresa
  const t = db.calls.find((x) => /TIMESTAMPDIFF/.test(x.sql));
  assert.match(t.sql, /o\.automatica = 0/); // resposta automatica nao conta como 1a resposta
  const bad = criarRes();
  await c.relatorios(req({ query: { de: 'x' } }), bad);
  assert.strictEqual(bad.statusCode, 400);
});

// ---------- IA ----------
test('IA: limpa CPF/telefone/e-mail, manda so texto da conversa, usa a chave do servidor e devolve o rascunho', async () => {
  limpar();
  process.env.ANTHROPIC_API_KEY = 'sk-teste';
  const original = axios.post;
  let enviado;
  axios.post = async (url, body, cfg) => { enviado = { url, body, cfg }; return { data: { content: [{ type: 'text', text: 'Olá Maria, já te ajudo!' }] } }; };
  try {
    const ia = carregar('src/services/sugestaoIA.js', { db: criarDb() });
    assert.strictEqual(ia.disponivel(), true);
    const r = await ia.sugerirResposta({
      nome: 'Maria Souza', empresa: 'Apex', plano: 'Plano 1h', restanteMin: 12,
      mensagens: [{ direcao: 'in', texto: 'meu cpf 123.456.789-09 tel (93) 99999-0000 mail a@b.com nao conecta' }, { direcao: 'nota', texto: 'segredo interno' }, { direcao: 'out', texto: 'Vou verificar' }, { direcao: 'in', texto: 'e agora?' }],
    });
    assert.strictEqual(r, 'Olá Maria, já te ajudo!');
    assert.match(enviado.url, /api\.anthropic\.com\/v1\/messages$/);
    assert.strictEqual(enviado.cfg.headers['x-api-key'], 'sk-teste');
    assert.strictEqual(enviado.body.model, 'claude-haiku-5-5');
    const conteudo = enviado.body.messages[0].content;
    assert.doesNotMatch(conteudo, /123\.456|99999|a@b\.com|segredo interno/);
    assert.match(conteudo, /\[cpf\]/);
    assert.match(conteudo, /Nome do cliente: Maria\b/);
    assert.doesNotMatch(conteudo, /Souza/);
    await assert.rejects(ia.sugerirResposta({ mensagens: [{ direcao: 'out', texto: 'oi' }] }), /mensagem do cliente/);
    delete process.env.ANTHROPIC_API_KEY;
    assert.strictEqual(ia.disponivel(), false);
    await assert.rejects(ia.sugerirResposta({ mensagens: [{ direcao: 'in', texto: 'oi' }] }), /IA não configurada/);
  } finally { axios.post = original; delete process.env.ANTHROPIC_API_KEY; }
});

test('IA: endpoint exige a chave no servidor e a liberacao da empresa; conversa de outra empresa = 404', async () => {
  limpar();
  const montar = (cfg) => carregar('src/controllers/atendimentoRelatoriosController.js', {
    db: criarDb((sql, p) => {
      if (/SELECT \* FROM whatsapp_conversas WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[{ id: 5, nome: 'Maria', lead_id: null }]] : [[]];
    }),
    extras: { 'src/services/whatsappAutomacao.js': { obterAutomacao: async () => cfg } },
  });
  process.env.ANTHROPIC_API_KEY = 'sk';
  try {
    let res = criarRes();
    await montar({ ia_sugestao: false }).sugerir(req({ params: { id: '5' } }), res);
    assert.strictEqual(res.statusCode, 403);
    res = criarRes();
    await montar({ ia_sugestao: true }).sugerir(req({ params: { id: '5' }, empresa_id: 8 }), res);
    assert.strictEqual(res.statusCode, 404);
    res = criarRes();
    await montar({ ia_sugestao: true }).iaStatus(req(), res);
    assert.deepStrictEqual(res.body, { disponivel: true, ativo: true });
    delete process.env.ANTHROPIC_API_KEY;
    res = criarRes();
    await montar({ ia_sugestao: true }).sugerir(req({ params: { id: '5' } }), res);
    assert.strictEqual(res.statusCode, 503);
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

// ---------- expurgo de midia ----------
test('expurgo: apaga so arquivos de uploads/whatsapp, marca a mensagem e respeita 0 = desligado e a migration', async () => {
  const midiaUtil = require('../../src/utils/whatsappMidia');
  const pasta = path.join(midiaUtil.RAIZ_MIDIA, `teste-${process.pid}`);
  fs.mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, 'a.jpg');
  fs.writeFileSync(arq, 'x');
  const fora = path.join(os.tmpdir(), `nao-apagar-${process.pid}.txt`);
  fs.writeFileSync(fora, 'x');
  try {
    limpar();
    let lote = 0;
    const db = criarDb((sql) => {
      if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[{ n: 1 }]];
      if (/FROM whatsapp_mensagens\s+WHERE midia_path IS NOT NULL/.test(sql)) return lote++ ? [[]] : [[
        { id: 1, empresa_id: 7, midia_path: `teste-${process.pid}/a.jpg` },
        { id: 2, empresa_id: 7, midia_path: `../../../../${fora}` }, // tentativa de sair da pasta
        { id: 3, empresa_id: 7, midia_path: `teste-${process.pid}/ja-apagado.jpg` },
      ]];
    });
    process.env.MIDIA_RETENCAO_DIAS = '30';
    const job = carregar('src/jobs/expurgaMidia.js', { db });
    const r = await job();
    assert.strictEqual(r.apagadas, 3);
    assert.strictEqual(fs.existsSync(arq), false);
    assert.strictEqual(fs.existsSync(fora), true); // nunca apaga fora da raiz
    const ups = db.calls.filter((c) => /SET midia_path = NULL, midia_expirada_em = NOW\(\)/.test(c.sql));
    assert.strictEqual(ups.length, 3);
    for (const u of ups) assert.match(u.sql, /empresa_id = \?/);
    const sel = db.calls.find((c) => /midia_path IS NOT NULL/.test(c.sql));
    assert.deepStrictEqual(sel.params, [30]);

    process.env.MIDIA_RETENCAO_DIAS = '0';
    assert.deepStrictEqual(await carregar('src/jobs/expurgaMidia.js', { db: criarDb() })(), { desligado: true });
    process.env.MIDIA_RETENCAO_DIAS = '30';
    limpar();
    const sem = carregar('src/jobs/expurgaMidia.js', { db: criarDb((sql) => (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) ? [[{ n: 0 }]] : undefined)) });
    assert.deepStrictEqual(await sem(), { sem_migration: true });
    delete process.env.MIDIA_RETENCAO_DIAS;
    assert.strictEqual(carregar('src/jobs/expurgaMidia.js', { db: criarDb() }).diasDeRetencao(), 90);
  } finally {
    delete process.env.MIDIA_RETENCAO_DIAS;
    fs.rmSync(pasta, { recursive: true, force: true });
    fs.rmSync(fora, { force: true });
  }
});

// ---------- painel "Hoje" ----------
test('dashboard/hoje: cada bloco falha sozinho e o WhatsApp so aparece com o recurso', async () => {
  const restaurar = semLog();
  try {
    limpar();
    const db = criarDb((sql) => {
      if (/FROM pagamentos/.test(sql)) return [[{ n: '3', total: '45.5' }]];
      if (/FROM radacct ra/.test(sql)) throw new Error('radacct fora');
      if (/FROM whatsapp_conversas/.test(sql)) return [[{ abertas: '4', nao_lidas: '9' }]];
      if (/FROM whatsapp_mensagens/.test(sql)) return [[{ recebidas: '10', enviadas: '6' }]];
    });
    let c = carregar('src/controllers/dashboardController.js', { db, extras: { 'src/utils/assinatura.js': { temRecurso: async () => true } } });
    let res = criarRes();
    await c.getHoje(req(), res);
    assert.deepStrictEqual(res.body.vendas, { aprovadas: 3, valor: 45.5 });
    assert.strictEqual(res.body.conexoes, null);
    assert.deepStrictEqual(res.body.whatsapp, { abertas: 4, nao_lidas: 9, recebidas_hoje: 10, enviadas_hoje: 6 });
    for (const q of db.calls) assert.ok(q.params.includes(7), q.sql);
    limpar();
    c = carregar('src/controllers/dashboardController.js', { db: criarDb(), extras: { 'src/utils/assinatura.js': { temRecurso: async () => false } } });
    res = criarRes();
    await c.getHoje(req(), res);
    assert.strictEqual(res.body.whatsapp, null);
  } finally { restaurar(); }
});
