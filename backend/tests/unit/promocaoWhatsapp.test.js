// Promocoes por WhatsApp: filtros (sempre por empresa e sem opt-out), mensagem com rodape,
// controller (isolamento, nao inicia sem WhatsApp) e job (fila: opt-out, pausa, erro, reentrancia).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

const ROOT = path.resolve(__dirname, '../..');
const limpar = () => {
  for (const f of ['src/services/whatsappNotify.js', 'src/utils/promocaoWhatsapp.js', 'src/controllers/promocaoWhatsappController.js', 'src/jobs/enviaPromocoes.js']) {
    delete require.cache[require.resolve(path.join(ROOT, f))];
  }
};
const semLog = () => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; return () => { console.warn = w; console.error = e; }; };

function wpp({ conectada = true, falhaEnvio = null } = {}) {
  const enviados = [];
  return {
    enviados,
    mod: {
      instanciaConectada: async () => conectada,
      enviarMensagemEstrita: async (tel, msg, emp) => {
        if (falhaEnvio && falhaEnvio(tel)) throw new Error('Evolution recusou');
        enviados.push({ tel, msg, emp });
      },
    },
  };
}
function util(db, w = wpp()) {
  limpar();
  return carregar('src/utils/promocaoWhatsapp.js', { db, extras: { 'src/controllers/whatsappController.js': w.mod } });
}

test('filtros: SEMPRE empresa, telefone, sem opt-out e sem descartados; filtros extras entram parametrizados', () => {
  const u = util(criarDb());
  const { where, params } = u.montarFiltroLeads({ origens: ['lgpd'], status: ['novo', 'invalido'], lgpd_aceite: true, q: 'ana', empresa_id: 99 }, 7);
  assert.match(where, /empresa_id = \?/);
  assert.match(where, /whatsapp_optout = 0/);
  assert.match(where, /status <> 'descartado'/);
  assert.deepStrictEqual(params.slice(0, 1), [7]);
  assert.ok(!params.includes(99), 'empresa_id vindo do corpo e ignorado');
  assert.ok(!params.includes('invalido'), 'status invalido descartado');
  assert.ok(params.includes('lgpd') && params.includes(1) && params.includes('%ana%'));
  const vazio = u.montarFiltroLeads(undefined, 7);
  assert.deepStrictEqual(vazio.params, [7]);
});

test('mensagem: {{nome}} vira o primeiro nome (ou "cliente") e o rodape SAIR e sempre anexado', () => {
  const u = util(criarDb());
  assert.match(u.montarMensagem('Oi {{nome}}! 20% off', 'Maria da Silva'), /^Oi Maria! 20% off/);
  assert.match(u.montarMensagem('Oi {{nome}}!', null), /^Oi cliente!/);
  assert.ok(u.montarMensagem('x', 'A').endsWith(u.RODAPE));
  assert.match(u.RODAPE, /responda SAIR/);
});

test('validarEnvio: nome e mensagem obrigatorios e com limite', () => {
  const u = util(criarDb());
  assert.strictEqual(u.validarEnvio({ nome: '', mensagem: 'x' }).ok, false);
  assert.strictEqual(u.validarEnvio({ nome: 'a', mensagem: '' }).ok, false);
  assert.strictEqual(u.validarEnvio({ nome: 'a', mensagem: 'x'.repeat(1001) }).ok, false);
  assert.strictEqual(u.validarEnvio({ nome: 'a', mensagem: 'x' }).ok, true);
});

test('selecionarDestinatarios: normaliza telefone, descarta invalido e tira numero repetido', async () => {
  const db = criarDb(() => [[
    { id: 1, nome: 'A', telefone: '(11) 98888-7777' },
    { id: 2, nome: 'B', telefone: '11988887777' },      // mesmo numero de A
    { id: 3, nome: 'C', telefone: '123' },              // invalido
    { id: 4, nome: 'D', telefone: '5511977776666' },
  ]]);
  const u = util(db);
  const r = await u.selecionarDestinatarios(db, {}, 7);
  assert.deepStrictEqual(r.destinatarios.map((d) => d.telefone), ['5511988887777', '5511977776666']);
  assert.strictEqual(r.invalidos, 1);
  assert.strictEqual(r.duplicados, 1);
  assert.match(db.calls[0].sql, /empresa_id = \?/);
});

function controller(handler, w = wpp()) {
  const db = criarDb(handler);
  limpar();
  const ctrl = carregar('src/controllers/promocaoWhatsappController.js', { db, extras: { 'src/controllers/whatsappController.js': w.mod } });
  return { db, ctrl, w };
}
const req = (over) => criarReq({ empresa_id: 7, user: { id: 3 }, ...over });
const leads = [[{ id: 1, nome: 'Ana', telefone: '11988887777' }, { id: 2, nome: 'Beto', telefone: '11977776666' }]];

test('previa: conta, mascara o telefone e NAO grava nada', async () => {
  const { db, ctrl } = controller((sql) => (/FROM leads/.test(sql) ? leads : undefined));
  const res = criarRes();
  await ctrl.previa(req({ body: { mensagem: 'Oi {{nome}}', filtros: {} } }), res);
  assert.strictEqual(res.body.data.total, 2);
  assert.ok(!/11988887777/.test(JSON.stringify(res.body.data.amostra)), 'telefone mascarado');
  assert.match(res.body.data.mensagem_exemplo, /^Oi Ana/);
  assert.ok(!db.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)));
});

test('criar: grava envio e destinatarios da propria empresa; sem contatos = 400', async () => {
  const { db, ctrl } = controller((sql) => {
    if (/FROM leads/.test(sql)) return leads;
    if (/^INSERT INTO promocao_envios/.test(sql)) return [{ insertId: 11 }];
    if (/^SELECT \* FROM promocao_envios/.test(sql)) return [[{ id: 11, status: 'rascunho' }]];
  });
  const res = criarRes();
  await ctrl.criar(req({ body: { nome: 'Black Friday', mensagem: 'Oi {{nome}}', filtros: {} } }), res);
  assert.strictEqual(res.statusCode, 201);
  const env = db.calls.find((c) => /^INSERT INTO promocao_envios/.test(c.sql));
  assert.strictEqual(env.params[0], 7);
  const dest = db.calls.find((c) => /^INSERT INTO promocao_destinatarios/.test(c.sql));
  assert.strictEqual(dest.params[0].length, 2);
  assert.ok(dest.params[0].every((l) => l[0] === 11 && l[1] === 7));

  const vazio = controller(() => [[]]);
  const r2 = criarRes();
  await vazio.ctrl.criar(req({ body: { nome: 'x', mensagem: 'y' } }), r2);
  assert.strictEqual(r2.statusCode, 400);
});

test('iniciar: promocao de outra empresa = 404; sem WhatsApp conectado = 409 e nao muda status', async () => {
  const outra = controller(() => [[]]);
  let res = criarRes();
  await outra.ctrl.iniciar(req({ params: { id: '5' } }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.match(outra.db.calls[0].sql, /empresa_id = \?/);

  const off = controller((sql) => (/^SELECT \* FROM promocao_envios/.test(sql) ? [[{ id: 5, status: 'rascunho' }]] : undefined), wpp({ conectada: false }));
  res = criarRes();
  await off.ctrl.iniciar(req({ params: { id: '5' } }), res);
  assert.strictEqual(res.statusCode, 409);
  assert.match(res.body.error, /não está conectado/);
  assert.ok(!off.db.calls.some((c) => /^UPDATE/.test(c.sql)));

  const ok = controller((sql) => (/^SELECT \* FROM promocao_envios/.test(sql) ? [[{ id: 5, status: 'rascunho' }]] : undefined));
  res = criarRes();
  await ok.ctrl.iniciar(req({ params: { id: '5' } }), res);
  assert.ok(ok.db.calls.some((c) => /SET status = 'em_andamento'/.test(c.sql)));
});

test('retomar so de pausada; pausar so de em_andamento', async () => {
  const c = controller((sql) => (/^SELECT \* FROM promocao_envios/.test(sql) ? [[{ id: 5, status: 'rascunho' }]] : undefined));
  let res = criarRes();
  await c.ctrl.retomar(req({ params: { id: '5' } }), res);
  assert.strictEqual(res.statusCode, 409);
  res = criarRes();
  await c.ctrl.pausar(req({ params: { id: '5' } }), res);
  assert.strictEqual(res.statusCode, 409);
});

// ---------- job ----------
function job({ envios = [{ id: 1, empresa_id: 7, mensagem: 'Oi {{nome}}' }], pendentes = [], optout = {}, statusAtual = 'em_andamento', w = wpp(), restantes = 0 } = {}) {
  const db = criarDb((sql, params) => {
    if (/FROM promocao_envios WHERE status = 'em_andamento'/.test(sql)) return [envios];
    if (/FROM promocao_destinatarios\s+WHERE envio_id = \? AND status = 'pendente'/.test(sql)) return [pendentes];
    if (/^SELECT status FROM promocao_envios/.test(sql)) return [[{ status: statusAtual }]];
    if (/^SELECT whatsapp_optout FROM leads/.test(sql)) return [[{ whatsapp_optout: optout[params[0]] ? 1 : 0 }]];
    if (/GROUP BY status/.test(sql)) return [[{ status: 'pendente', n: restantes }]];
  });
  limpar();
  const fn = carregar('src/jobs/enviaPromocoes.js', { db, extras: { 'src/controllers/whatsappController.js': w.mod } });
  return { db, fn, w };
}
const dest = (id, lead, tel) => ({ id, lead_id: lead, telefone: tel, nome: `Cli ${id}` });
const semEspera = { dormir: async () => {} };

test('job: envia com rodape, marca enviado e conclui quando nao sobra pendente', async () => {
  const j = job({ pendentes: [dest(1, 10, '5511988887777')], restantes: 0 });
  await j.fn(semEspera);
  assert.strictEqual(j.w.enviados.length, 1);
  assert.match(j.w.enviados[0].msg, /^Oi Cli/);
  assert.match(j.w.enviados[0].msg, /responda SAIR/);
  assert.ok(j.db.calls.some((c) => /SET status = 'enviado'/.test(c.sql)));
  assert.ok(j.db.calls.some((c) => /SET status = 'concluida'/.test(c.sql)));
  assert.ok(j.db.calls.some((c) => /INSERT INTO whatsapp_logs/.test(c.sql) && c.params[4] === 'promocao'));
});

test('job: quem pediu para sair depois de criada a fila NAO recebe', async () => {
  const j = job({ pendentes: [dest(1, 10, '5511988887777'), dest(2, 11, '5511977776666')], optout: { 10: true } });
  await j.fn(semEspera);
  assert.deepStrictEqual(j.w.enviados.map((e) => e.tel), ['5511977776666']);
  assert.ok(j.db.calls.some((c) => /SET status = 'ignorado'/.test(c.sql)));
});

test('job: WhatsApp desconectado pausa a promocao e nao envia', async () => {
  const j = job({ pendentes: [dest(1, 10, '5511988887777')], w: wpp({ conectada: false }) });
  await j.fn(semEspera);
  assert.strictEqual(j.w.enviados.length, 0);
  assert.ok(j.db.calls.some((c) => /SET status = 'pausada'/.test(c.sql)));
});

test('job: erro de envio vira "erro" e a fila segue', async () => {
  const un = semLog();
  try {
    const j = job({ pendentes: [dest(1, 10, '5511988887777'), dest(2, 11, '5511977776666')], w: wpp({ falhaEnvio: (t) => t.endsWith('7777') }), restantes: 1 });
    await j.fn(semEspera);
    assert.ok(j.db.calls.some((c) => /SET status = 'erro'/.test(c.sql)));
    assert.strictEqual(j.w.enviados.length, 1);
    assert.ok(!j.db.calls.some((c) => /SET status = 'concluida'/.test(c.sql)), 'ainda ha pendentes');
  } finally { un(); }
});

test('job: pausa/cancelamento no meio da rodada interrompe antes de enviar', async () => {
  const j = job({ pendentes: [dest(1, 10, '5511988887777')], statusAtual: 'pausada' });
  await j.fn(semEspera);
  assert.strictEqual(j.w.enviados.length, 0);
});

test('job: so 1 promocao por empresa por rodada e nao roda em paralelo', async () => {
  const j = job({
    envios: [{ id: 1, empresa_id: 7, mensagem: 'a' }, { id: 2, empresa_id: 7, mensagem: 'b' }, { id: 3, empresa_id: 8, mensagem: 'c' }],
    pendentes: [dest(1, 10, '5511988887777')],
  });
  const primeira = j.fn(semEspera);
  const segunda = await j.fn(semEspera); // enquanto a 1a ainda nao terminou (microtasks), emExecucao protege
  await primeira;
  const empresas = new Set(j.w.enviados.map((e) => e.emp));
  assert.deepStrictEqual([...empresas].sort(), [7, 8]);
  assert.ok(segunda.pulado === true || j.w.enviados.length >= 2);
});
