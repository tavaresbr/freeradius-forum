// Aviso operacional: validacao, selecao de quem esta conectado, controller e envio sem rodape de marketing.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const a = require('../../src/utils/avisoOperacional');
const notifyReal = require('../../src/services/whatsappNotify');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => ['src/controllers/avisoOperacionalController.js', 'src/jobs/enviaPromocoes.js', 'src/utils/schemaCache.js']
  .forEach((f) => delete require.cache[require.resolve(path.join(ROOT, f))]);
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

test('validarAviso: mensagem obrigatoria, limites e equipamento numerico; titulo padrao', () => {
  assert.deepStrictEqual(a.validarAviso({ mensagem: ' Oi ' }), { ok: true, nome: 'Aviso operacional', mensagem: 'Oi', equipamento_id: null });
  assert.strictEqual(a.validarAviso({ mensagem: 'x', equipamento_id: '4' }).equipamento_id, 4);
  assert.match(a.validarAviso({ mensagem: '' }).erro, /Escreva a mensagem/);
  assert.match(a.validarAviso({ mensagem: 'x'.repeat(1001) }).erro, /no máximo 1000/);
  assert.match(a.validarAviso({ mensagem: 'x', equipamento_id: 'abc' }).erro, /Equipamento inválido/);
  assert.match(a.validarAviso({ mensagem: 'x', equipamento_id: -1 }).erro, /Equipamento inválido/);
  assert.match(a.validarAviso({ mensagem: 'x', nome: 'n'.repeat(151) }).erro, /título/);
});

test('montarMensagemAviso: 1o nome e SEM o rodape de marketing', () => {
  const m = a.montarMensagemAviso('Oi {{nome}}, estamos com instabilidade.', 'Maria Souza');
  assert.strictEqual(m, 'Oi Maria, estamos com instabilidade.');
  assert.doesNotMatch(m, /SAIR/);
  assert.strictEqual(a.montarMensagemAviso('Oi {{nome}}', ''), 'Oi cliente');
});

test('selecionarConectados: escopado por empresa, so sessao aberta, sem opt-out; equipamento filtra pela mesma empresa; dedup e limite', async () => {
  const rows = [
    { id: 1, nome: 'Ana', telefone: '(93) 99999-0000' },
    { id: 2, nome: 'Ana 2', telefone: '93999990000' }, // mesmo numero
    { id: 3, nome: 'Bia', telefone: '12' },            // invalido
    { id: 4, nome: 'Caio', telefone: '93988887777' },
  ];
  const db = criarDb(() => [rows]);
  const r = await a.selecionarConectados(db, 7, 3);
  assert.deepStrictEqual(r.destinatarios.map((d) => d.lead_id), [1, 4]);
  assert.strictEqual(r.duplicados, 1);
  assert.strictEqual(r.invalidos, 1);
  const q = db.calls[0];
  assert.match(q.sql, /l\.empresa_id = \?/);
  assert.match(q.sql, /whatsapp_optout = 0/);
  assert.match(q.sql, /ra\.acctstoptime IS NULL/);
  assert.match(q.sql, /m\.id = \? AND m\.empresa_id = \?/);
  assert.deepStrictEqual(q.params, [7, 7, 3, 7]);
  const sem = criarDb(() => [rows]);
  await a.selecionarConectados(sem, 7, null);
  assert.doesNotMatch(sem.calls[0].sql, /mikrotiks/);
  assert.deepStrictEqual(sem.calls[0].params, [7, 7]);
});

// ---------- controller ----------
const montar = (handler, extras = {}) => {
  limpar();
  const db = criarDb(handler);
  const c = carregar('src/controllers/avisoOperacionalController.js', {
    db,
    extras: { 'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async () => {}, ...extras } },
  });
  return { c, db };
};
const rq = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: {}, body: {}, ...over });
const colunaOk = (sql) => (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) ? [[{ n: 1 }]] : undefined);

test('criar: grava como tipo aviso com os conectados; sem a migration 057 = 503; equipamento de outra empresa = 400; ninguem conectado = 400', async () => {
  const restaurar = semLog();
  try {
    let { c, db } = montar((sql) => {
      const col = colunaOk(sql); if (col) return col;
      if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ id: 3 }]];
      if (/FROM leads l/.test(sql)) return [[{ id: 1, nome: 'Ana', telefone: '93999990000' }]];
      if (/INSERT INTO promocao_envios/.test(sql)) return [{ insertId: 9 }];
      if (/SELECT \* FROM promocao_envios/.test(sql)) return [[{ id: 9, tipo: 'aviso', status: 'rascunho' }]];
    });
    let res = criarRes();
    await c.criar(rq({ body: { mensagem: 'Queda no centro', equipamento_id: 3 } }), res);
    assert.strictEqual(res.statusCode, 201);
    const ins = db.calls.find((x) => /INSERT INTO promocao_envios/.test(x.sql));
    assert.match(ins.sql, /'aviso'/);
    assert.strictEqual(ins.params[0], 7);
    const dest = db.calls.find((x) => /INSERT INTO promocao_destinatarios/.test(x.sql));
    assert.strictEqual(dest.params[0][0][1], 7); // empresa_id em cada destinatario

    ({ c } = montar((sql) => (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) ? [[{ n: 0 }]] : undefined)));
    res = criarRes();
    await c.criar(rq({ body: { mensagem: 'x' } }), res);
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.body.error, /migration 057/);

    ({ c } = montar((sql) => colunaOk(sql) || (/FROM mikrotiks WHERE id/.test(sql) ? [[]] : undefined)));
    res = criarRes();
    await c.criar(rq({ body: { mensagem: 'x', equipamento_id: 99 } }), res);
    assert.strictEqual(res.statusCode, 400);

    ({ c } = montar((sql) => colunaOk(sql) || (/FROM leads l/.test(sql) ? [[]] : undefined)));
    res = criarRes();
    await c.criar(rq({ body: { mensagem: 'x' } }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /Nenhum cliente conectado/);
  } finally { restaurar(); }
});

test('listar so avisos da empresa; testar manda [TESTE] sem rodape; telefone invalido = 400', async () => {
  const enviados = [];
  const { c, db } = montar((sql) => colunaOk(sql) || (/FROM promocao_envios/.test(sql) ? [[{ id: 9 }]] : undefined), { enviarMensagemEstrita: async (...x) => { enviados.push(x); } });
  let res = criarRes();
  await c.listar(rq(), res);
  const q = db.calls.find((x) => /FROM promocao_envios/.test(x.sql));
  assert.match(q.sql, /empresa_id = \? AND tipo = 'aviso'/);
  assert.deepStrictEqual(q.params, [7]);
  res = criarRes();
  await c.testar(rq({ body: { mensagem: 'Oi {{nome}}', telefone: '(93) 99999-0000' } }), res);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(enviados[0][1], '[TESTE] Oi Cliente');
  res = criarRes();
  await c.testar(rq({ body: { mensagem: 'x', telefone: '1' } }), res);
  assert.strictEqual(res.statusCode, 400);
});

// ---------- worker ----------
test('worker: envio tipo aviso sai SEM rodape e com log aviso_operacional; promocao continua com rodape', async () => {
  for (const [tipo, esperaRodape, ctx] of [['aviso', false, 'aviso_operacional'], ['promocao', true, 'promocao']]) {
    limpar();
    const enviados = [];
    const logs = [];
    const db = criarDb((sql) => {
      if (/FROM promocao_envios WHERE status = 'em_andamento'/.test(sql)) return [[{ id: 5, empresa_id: 7, mensagem: 'Oi {{nome}}', tipo }]];
      if (/SELECT status FROM promocao_envios WHERE id/.test(sql)) return [[{ status: 'em_andamento' }]];
      if (/FROM promocao_destinatarios\s+WHERE envio_id = \? AND status = 'pendente'/.test(sql)) return [[{ id: 1, lead_id: 10, telefone: '5593999990000', nome: 'Maria Souza' }]];
      if (/SELECT whatsapp_optout FROM leads/.test(sql)) return [[{ whatsapp_optout: 0 }]];
      if (/SELECT status, COUNT/.test(sql)) return [[{ status: 'enviado', n: 1 }]];
    });
    const job = carregar('src/jobs/enviaPromocoes.js', {
      db,
      extras: {
        'src/utils/assinatura.js': { temRecurso: async () => true },
        'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async (...x) => { enviados.push(x); } },
        'src/services/whatsappNotify.js': { ...notifyReal, gravarLog: async (x) => { logs.push(x); } },
      },
    });
    await job({ dormir: async () => {} });
    assert.strictEqual(enviados.length, 1, tipo);
    assert.strictEqual(/responda SAIR/i.test(enviados[0][1]), esperaRodape, tipo);
    assert.match(enviados[0][1], /^Oi Maria/);
    assert.strictEqual(logs[0].contexto_tipo, ctx);
  }
});
