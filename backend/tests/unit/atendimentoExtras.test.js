// Atendimento WhatsApp fase 3: notas, etiquetas, respostas rapidas, painel do cliente, nova conversa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };
const wpp = () => ({
  getEvolutionConfig: async () => ({ apiUrl: 'http://evo', apiKey: 'k', instanceName: 'empresa_7' }),
  formatarNumeroComNonoDigito: (n) => n,
});
const enviados = [];
function ctrl(db) {
  for (const f of ['src/services/whatsappAtendimento.js', 'src/controllers/atendimentoExtrasController.js']) delete require.cache[require.resolve(path.join(ROOT, f))];
  enviados.length = 0;
  const svc = { MAX_TEXTO: 4000, enviarTexto: async (...a) => { enviados.push(a); return { id: 1 }; } };
  return carregar('src/controllers/atendimentoExtrasController.js', { db, extras: { 'src/controllers/whatsappController.js': wpp(), 'src/services/whatsappAtendimento.js': svc } });
}
const conv = { id: 5, jid: '5593999990000@s.whatsapp.net', telefone: '5593999990000', nome: 'Maria', lead_id: null };
const dbConv = (extra) => criarDb((sql, p) => {
  if (extra) { const r = extra(sql, p); if (r !== undefined) return r; }
  if (/SELECT \* FROM whatsapp_conversas WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[conv]] : [[]];
});
const req = (over = {}) => criarReq({ empresa_id: 7, user: { id: 3 }, params: { id: '5' }, body: {}, ...over });

test('nota interna: grava como "nota" da empresa/usuario, sem tocar na conversa e sem enviar ao cliente', async () => {
  const db = dbConv();
  const res = criarRes();
  await ctrl(db).criarNota(req({ body: { texto: '  Cliente pediu retorno amanhã ' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const ins = db.calls.find((c) => /INSERT INTO whatsapp_mensagens/.test(c.sql));
  assert.match(ins.sql, /'nota'/);
  assert.strictEqual(ins.params[0], 7);
  assert.match(ins.params[2], /^nota_/);
  assert.strictEqual(ins.params[3], 'Cliente pediu retorno amanhã');
  assert.strictEqual(ins.params[4], 3);
  assert.ok(!db.calls.some((c) => /UPDATE whatsapp_conversas/.test(c.sql)));
  assert.strictEqual(enviados.length, 0);
  let r2 = criarRes();
  await ctrl(dbConv()).criarNota(req({ body: { texto: '   ' } }), r2);
  assert.strictEqual(r2.statusCode, 400);
  r2 = criarRes();
  await ctrl(dbConv()).criarNota(req({ empresa_id: 8, body: { texto: 'x' } }), r2);
  assert.strictEqual(r2.statusCode, 404);
});

test('etiquetas: valida nome/cor, escopa por empresa e responde 409 no nome repetido', async () => {
  const fim = semLog();
  try {
    let res = criarRes();
    await ctrl(criarDb()).criarEtiqueta(req({ body: { nome: '', cor: '#112233' } }), res);
    assert.strictEqual(res.statusCode, 400);
    for (const cor of ['red', '#12', 'javascript:alert(1)', '#gggggg']) {
      res = criarRes();
      await ctrl(criarDb()).criarEtiqueta(req({ body: { nome: 'VIP', cor } }), res);
      assert.strictEqual(res.statusCode, 400, cor);
    }
    const db = criarDb((sql) => (/INSERT INTO whatsapp_etiquetas/.test(sql) ? [{ insertId: 4 }] : undefined));
    res = criarRes();
    await ctrl(db).criarEtiqueta(req({ body: { nome: ' VIP ', cor: '#AABBCC' } }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(db.calls[0].params, [7, 'VIP', '#aabbcc']);
    const dup = criarDb(() => { throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); });
    res = criarRes();
    await ctrl(dup).criarEtiqueta(req({ body: { nome: 'VIP', cor: '#aabbcc' } }), res);
    assert.strictEqual(res.statusCode, 409);
    const del = criarDb((sql) => (/DELETE FROM whatsapp_etiquetas/.test(sql) ? [{ affectedRows: 1 }] : undefined));
    res = criarRes();
    await ctrl(del).excluirEtiqueta(req({ params: { id: '9' } }), res);
    assert.deepStrictEqual(del.calls[0].params, [9, 7]);
    assert.match(del.calls[1].sql, /DELETE FROM whatsapp_conversa_etiquetas WHERE etiqueta_id = \? AND empresa_id = \?/);
  } finally { fim(); }
});

test('etiquetas da conversa: so aceita ids da propria empresa (e no maximo 20)', async () => {
  const db = dbConv((sql, p) => (/SELECT id FROM whatsapp_etiquetas WHERE empresa_id = \? AND id IN/.test(sql) ? [p.slice(1).map((id) => ({ id })).filter((r) => r.id !== 99)] : undefined));
  let res = criarRes();
  await ctrl(db).definirEtiquetasDaConversa(req({ body: { ids: [1, 99] } }), res);
  assert.strictEqual(res.statusCode, 400, 'etiqueta de outra empresa');
  assert.ok(!db.calls.some((c) => /DELETE FROM whatsapp_conversa_etiquetas|INSERT INTO whatsapp_conversa_etiquetas/.test(c.sql)));
  for (const ids of ['1', [1, 'x'], [1.5], Array.from({ length: 21 }, (_, i) => i + 1)]) {
    res = criarRes();
    await ctrl(dbConv()).definirEtiquetasDaConversa(req({ body: { ids } }), res);
    assert.strictEqual(res.statusCode, 400);
  }
  const ok = dbConv((sql, p) => (/SELECT id FROM whatsapp_etiquetas/.test(sql) ? [p.slice(1).map((id) => ({ id }))] : undefined));
  res = criarRes();
  await ctrl(ok).definirEtiquetasDaConversa(req({ body: { ids: [1, 2, 2] } }), res);
  assert.strictEqual(res.statusCode, 200);
  const ins = ok.calls.find((c) => /INSERT INTO whatsapp_conversa_etiquetas/.test(c.sql));
  assert.deepStrictEqual(ins.params[0], [[5, 1, 7], [5, 2, 7]]);
});

test('respostas rapidas: atalho normalizado/validado, 409 repetido, escopo por empresa', async () => {
  const fim = semLog();
  try {
    let db = criarDb((sql) => (/INSERT INTO whatsapp_respostas_rapidas/.test(sql) ? [{ insertId: 2 }] : undefined));
    let res = criarRes();
    await ctrl(db).criarResposta(req({ body: { atalho: '/Ola', titulo: 'Saudação', texto: 'Olá {{nome}}!' } }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(db.calls[0].params, [7, 'ola', 'Saudação', 'Olá {{nome}}!']);
    for (const body of [{ atalho: 'a b', titulo: 't', texto: 'x' }, { atalho: '', titulo: 't', texto: 'x' }, { atalho: 'ok', titulo: '', texto: 'x' }, { atalho: 'ok', titulo: 't', texto: '' }, { atalho: 'x'.repeat(31), titulo: 't', texto: 'x' }]) {
      res = criarRes();
      await ctrl(criarDb()).criarResposta(req({ body }), res);
      assert.strictEqual(res.statusCode, 400, JSON.stringify(body));
    }
    res = criarRes();
    await ctrl(criarDb(() => { throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); })).criarResposta(req({ body: { atalho: 'ola', titulo: 't', texto: 'x' } }), res);
    assert.strictEqual(res.statusCode, 409);
    db = criarDb((sql) => (/UPDATE whatsapp_respostas_rapidas/.test(sql) ? [{ affectedRows: 0 }] : undefined));
    res = criarRes();
    await ctrl(db).atualizarResposta(req({ params: { id: '3' }, body: { atalho: 'ola', titulo: 't', texto: 'x' } }), res);
    assert.strictEqual(res.statusCode, 404);
    assert.match(db.calls[0].sql, /WHERE id = \? AND empresa_id = \?/);
  } finally { fim(); }
});

test('painel do cliente: CPF mascarado, lead da empresa, plano e ultimo pagamento por CPF; sem lead = vazio', async () => {
  const lead = { id: 11, nome: 'Maria Silva', cpf: '529.982.247-25', email: 'm@x.com', telefone: '93999990000', status: 'novo', origem: 'lgpd', whatsapp_optout: 0, lgpd_aceite: 1 };
  const db = dbConv((sql, p) => {
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Provedor X' }]];
    if (/SELECT \* FROM leads WHERE id = \? AND empresa_id = \?/.test(sql)) return p[1] === 7 ? [[lead]] : [[]];
    if (/FROM radius_users ru/.test(sql)) return [[{ nome: 'Plano 1h', duracao_minutos: 60 }]];
    if (/FROM pagamentos pg/.test(sql)) return [[{ valor: 5, status: 'approved', metodo_pagamento: 'pix', criado_em: 'x', plano: 'Plano 1h' }]];
  });
  const res = criarRes();
  await ctrl(db).clienteDaConversa(req({ params: { id: '5' } }), res);
  // conversa sem lead_id e telefone com 13 digitos: cai na busca por telefone (REGEXP) — simulada abaixo
  assert.strictEqual(res.body.empresa, 'Provedor X');
  const db2 = criarDb((sql, p) => {
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[{ ...conv, lead_id: 11 }]];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Provedor X' }]];
    if (/SELECT \* FROM leads WHERE id = \? AND empresa_id = \?/.test(sql)) return [[lead]];
    if (/FROM radius_users ru/.test(sql)) return [[{ nome: 'Plano 1h', duracao_minutos: 60 }]];
    if (/FROM pagamentos pg/.test(sql)) return [[{ valor: 5, status: 'approved', metodo_pagamento: 'pix', criado_em: 'x', plano: 'Plano 1h' }]];
  });
  const r2 = criarRes();
  await ctrl(db2).clienteDaConversa(req(), r2);
  assert.strictEqual(r2.body.lead.cpf, '529.***.***-25');
  assert.ok(!JSON.stringify(r2.body).includes('982.247'), 'CPF inteiro nunca sai');
  assert.deepStrictEqual(r2.body.plano, { nome: 'Plano 1h', duracao_minutos: 60 });
  assert.strictEqual(r2.body.ultimo_pagamento.status, 'approved');
  const pg = db2.calls.find((c) => /FROM pagamentos pg/.test(c.sql));
  assert.strictEqual(pg.params[0], 7);
  assert.strictEqual(pg.params[1], '52998224725');
  const r3 = criarRes();
  await ctrl(dbConv()).clienteDaConversa(req({ empresa_id: 8 }), r3);
  assert.strictEqual(r3.statusCode, 404);
});

test('vincular: lead de outra empresa = 404; null desvincula; criar-cliente sem telefone = 400, com telefone cadastra sem CPF/LGPD', async () => {
  let db = dbConv((sql, p) => (/SELECT id, nome FROM leads WHERE id = \? AND empresa_id = \?/.test(sql) ? (p[1] === 7 ? [[{ id: 4, nome: 'Ana' }]] : [[]]) : undefined));
  let res = criarRes();
  await ctrl(db).vincularCliente(req({ body: { lead_id: 4 } }), res);
  assert.strictEqual(res.statusCode, 200);
  const up = db.calls.find((c) => /UPDATE whatsapp_conversas SET lead_id = \?/.test(c.sql));
  assert.deepStrictEqual(up.params, [4, 'Ana', 5, 7]);
  db = dbConv((sql) => (/SELECT id, nome FROM leads/.test(sql) ? [[]] : undefined));
  res = criarRes();
  await ctrl(db).vincularCliente(req({ body: { lead_id: 4 } }), res);
  assert.strictEqual(res.statusCode, 404);
  res = criarRes();
  await ctrl(dbConv()).vincularCliente(req({ body: { lead_id: 'x' } }), res);
  assert.strictEqual(res.statusCode, 400);
  db = dbConv();
  res = criarRes();
  await ctrl(db).vincularCliente(req({ body: { lead_id: null } }), res);
  assert.match(db.calls.pop().sql, /SET lead_id = NULL/);

  db = criarDb((sql, p) => {
    if (/SELECT \* FROM whatsapp_conversas/.test(sql)) return [[{ ...conv, telefone: null }]];
  });
  res = criarRes();
  await ctrl(db).criarClienteDaConversa(req(), res);
  assert.strictEqual(res.statusCode, 400);

  db = dbConv((sql) => (/INSERT INTO leads/.test(sql) ? [{ insertId: 50 }] : undefined));
  res = criarRes();
  await ctrl(db).criarClienteDaConversa(req(), res);
  assert.strictEqual(res.body.id, 50);
  const ins = db.calls.find((c) => /INSERT INTO leads/.test(c.sql));
  assert.match(ins.sql, /'whatsapp', 'whatsapp', 'novo', 0/);
  assert.deepStrictEqual(ins.params, [7, 'Maria', '5593999990000']);
});

test('nova conversa: telefone invalido 400; opt-out 409; conversa existente e reaproveitada; nova cria e envia o 1o texto', async () => {
  const fim = semLog();
  try {
    let res = criarRes();
    await ctrl(criarDb()).novaConversa(req({ body: { telefone: '123' } }), res);
    assert.strictEqual(res.statusCode, 400);

    let db = criarDb((sql) => (/whatsapp_optout = 1/.test(sql) ? [[{ id: 1 }]] : undefined));
    res = criarRes();
    await ctrl(db).novaConversa(req({ body: { telefone: '(93) 99999-0000', texto: 'oi' } }), res);
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(db.calls[0].params[0], 7);

    db = criarDb((sql) => {
      if (/whatsapp_optout = 1/.test(sql)) return [[]];
      if (/SELECT \* FROM whatsapp_conversas WHERE empresa_id = \?/.test(sql)) return [[conv]];
    });
    res = criarRes();
    await ctrl(db).novaConversa(req({ body: { telefone: '93999990000', texto: 'Olá' } }), res);
    assert.deepStrictEqual({ id: res.body.id, criada: res.body.criada }, { id: 5, criada: false });
    assert.ok(!db.calls.some((c) => /INSERT INTO whatsapp_conversas/.test(c.sql)));
    assert.strictEqual(enviados.length, 1);

    db = criarDb((sql, p) => {
      if (/whatsapp_optout = 1/.test(sql)) return [[]];
      if (/SELECT \* FROM whatsapp_conversas WHERE empresa_id = \?/.test(sql)) return [[]];
      if (/FROM leads WHERE empresa_id = \? AND telefone IS NOT NULL/.test(sql)) return [[]];
      if (/INSERT INTO whatsapp_conversas/.test(sql)) return [{ insertId: 77 }];
      if (/SELECT \* FROM whatsapp_conversas WHERE id = \?/.test(sql)) return [[{ ...conv, id: 77 }]];
    });
    res = criarRes();
    await ctrl(db).novaConversa(req({ body: { telefone: '93999990000', nome: 'Carlos', texto: 'Olá Carlos' } }), res);
    assert.deepStrictEqual({ id: res.body.id, criada: res.body.criada }, { id: 77, criada: true });
    const ins = db.calls.find((c) => /INSERT INTO whatsapp_conversas/.test(c.sql));
    assert.deepStrictEqual(ins.params.slice(0, 4), [7, '5593999990000@s.whatsapp.net', '5593999990000', 'Carlos']);
    assert.strictEqual(enviados[0][0], 7);
    assert.strictEqual(enviados[0][3], 'Olá Carlos');
  } finally { fim(); }
});
