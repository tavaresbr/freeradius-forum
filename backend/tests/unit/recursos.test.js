// SaaS Fase 2: recursos por plano/adicional (WhatsApp, Campanhas, Exportacao) e limite de portais.
const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes } = require('../helpers/mocks');

const DIA = 86400000;
const futuro = () => new Date(Date.now() + 10 * DIA);
const PLANO = (over = {}) => ({ plano_id: 2, status: 'ativa', vence_em: futuro(), carencia_dias: 3, nome: 'Start', valor: 59.9,
  max_equipamentos: 2, max_admins: 1, inclui_whatsapp: 0, inclui_campanhas: 0, inclui_exportacao: 0, max_portais: 5, ...over });
const ADIC = (tipo, over = {}) => ({ id: 1, adicional_id: 9, quantidade: 1, vence_em: futuro(), nome: 'x', tipo, incremento: 1, valor: 10, ciclo_dias: 30, ...over });

// db falso por empresa: { plano, adicionais, erro }
function montar({ plano = PLANO(), adicionais = [], erro = null, portais = 0 } = {}) {
  const db = criarDb(async (sql) => {
    if (erro) throw erro;
    if (/FROM assinaturas a LEFT JOIN saas_planos/.test(sql)) return [[plano === null ? undefined : { ...plano, plano_nome: plano.nome, plano_valor: plano.valor }]];
    if (/FROM assinatura_adicionais aa/.test(sql)) return [adicionais];
    if (/COUNT\(\*\) AS n FROM portais/.test(sql)) return [[{ n: portais }]];
    return undefined;
  });
  const ass = carregar('src/utils/assinatura.js', { db });
  return { db, ass };
}
const recursoMw = (ass, db) => {
  // o middleware recarrega utils/assinatura: aponta para a mesma instancia com o db falso
  delete require.cache[require.resolve('../../src/middleware/recurso')];
  return require('../../src/middleware/recurso');
};

test('recursos: plano que inclui, adicional vigente, nenhum dos dois', async () => {
  let { ass } = montar({ plano: PLANO({ inclui_whatsapp: 1 }) });
  let st = await ass.obterStatus(1);
  assert.deepStrictEqual(st.recursos, { whatsapp: true, campanhas: false, exportacao: false, dominio: true });

  ({ ass } = montar({ adicionais: [ADIC('campanhas')] }));
  st = await ass.obterStatus(1);
  assert.deepStrictEqual(st.recursos, { whatsapp: false, campanhas: true, exportacao: false, dominio: true });
  assert.deepStrictEqual(st.plano_recursos, { whatsapp: false, campanhas: false, exportacao: false, dominio: true });

  ({ ass } = montar());
  assert.strictEqual(await ass.temRecurso(1, 'exportacao'), false);
});

test('recursos: sem a migration 043 (colunas ausentes) nada e bloqueado', async () => {
  const { ass } = montar({ plano: { plano_id: 2, status: 'ativa', vence_em: futuro(), carencia_dias: 3, nome: 'Start', valor: 59.9, max_equipamentos: 2, max_admins: 1 } });
  assert.deepStrictEqual((await ass.obterStatus(1)).recursos, { whatsapp: true, campanhas: true, exportacao: true, dominio: true });
});

test('max_portais efetivo soma adicionais; NULL continua ilimitado; checarLimite conta portais', async () => {
  let { ass } = montar({ plano: PLANO({ max_portais: 5 }), adicionais: [ADIC('portais', { incremento: 2, quantidade: 2 })], portais: 8 });
  assert.strictEqual((await ass.obterStatus(1)).max_portais, 9);
  assert.strictEqual((await ass.checarLimite(1, 'portais')).ok, true);

  ({ ass } = montar({ plano: PLANO({ max_portais: 5 }), portais: 5 }));
  const l = await ass.checarLimite(1, 'portais');
  assert.strictEqual(l.ok, false);
  assert.match(l.mensagem, /portais/);

  ({ ass } = montar({ plano: PLANO({ max_portais: null }), portais: 50 }));
  assert.strictEqual((await ass.checarLimite(1, 'portais')).ok, true);
});

test('middleware exigeRecurso: 403 sem recurso, passa com recurso, super_admin sempre passa', async () => {
  let { ass, db } = montar();
  let res = criarRes(); let seguiu = false;
  await recursoMw(ass, db)('whatsapp')({ user: { role: 'owner' }, empresa_id: 1 }, res, () => { seguiu = true; });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'RECURSO_NAO_CONTRATADO');
  assert.strictEqual(seguiu, false);

  ({ ass, db } = montar({ plano: PLANO({ inclui_whatsapp: 1 }) }));
  seguiu = false;
  await recursoMw(ass, db)('whatsapp')({ user: { role: 'owner' }, empresa_id: 1 }, criarRes(), () => { seguiu = true; });
  assert.strictEqual(seguiu, true);

  ({ ass, db } = montar());
  seguiu = false;
  await recursoMw(ass, db)('whatsapp')({ user: { role: 'super_admin' }, empresa_id: 1 }, criarRes(), () => { seguiu = true; });
  assert.strictEqual(seguiu, true);
});

test('middleware exigeRecurso: tabela ausente libera; erro de banco => 503', async () => {
  let { ass, db } = montar({ erro: Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }) });
  let seguiu = false;
  await recursoMw(ass, db)('campanhas')({ user: { role: 'owner' }, empresa_id: 1 }, criarRes(), () => { seguiu = true; });
  assert.strictEqual(seguiu, true);

  ({ ass, db } = montar({ erro: new Error('db down') }));
  const res = criarRes(); seguiu = false;
  const un = console.error; console.error = () => {};
  try { await recursoMw(ass, db)('campanhas')({ user: { role: 'owner' }, empresa_id: 1 }, res, () => { seguiu = true; }); } finally { console.error = un; }
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(seguiu, false);
});

test('campanhaAtivaInfo: empresa sem o recurso nao tem pre-portal', async () => {
  const db = criarDb(async (sql) => {
    if (/FROM portais p JOIN campanhas c/.test(sql)) return [[{ id: 5, frequencia: 'sempre', empresa_id: 7 }]];
    if (/FROM assinaturas a LEFT JOIN saas_planos/.test(sql)) return [[{ ...PLANO(), plano_nome: 'S', plano_valor: 1 }]];
    if (/FROM assinatura_adicionais aa/.test(sql)) return [[]];
    return undefined;
  });
  delete require.cache[require.resolve('../../src/utils/assinatura')];
  const m = carregar('src/utils/campanhaAtiva.js', { db });
  assert.strictEqual(await m.campanhaAtivaInfo(1), null);
});

test('notificarLiberacao: sem o recurso WhatsApp grava skipped e nao envia nem lanca', async () => {
  const enviados = [];
  const db = criarDb(async (sql) => {
    if (/FROM assinaturas a LEFT JOIN saas_planos/.test(sql)) return [[{ ...PLANO(), plano_nome: 'S', plano_valor: 1 }]];
    if (/FROM assinatura_adicionais aa/.test(sql)) return [[]];
    return undefined;
  });
  delete require.cache[require.resolve('../../src/utils/assinatura')];
  const mod = carregar('src/services/whatsappNotify.js', {
    db, extras: { 'src/controllers/whatsappController.js': { enviarMensagemDireta: async (t, m) => { enviados.push({ t, m }); } } },
  });
  const r = await mod.notificarLiberacao({ empresa_id: 5, portal_id: 1, telefone: '11977776666', vars: {} });
  assert.strictEqual(r.skipped, 'sem_recurso');
  assert.strictEqual(enviados.length, 0);
  assert.ok(db.calls.some((c) => /INSERT INTO whatsapp_logs/.test(c.sql) && c.params.includes('sem_recurso')));
});

test('motivoIndisponivel: recurso liga/desliga recusa quando ja incluido; renovacao so se o plano inclui', () => {
  const { motivoIndisponivel } = require('../../src/controllers/assinaturaController');
  const ad = { tipo: 'whatsapp', plano_minimo_id: null };
  const st = (r, pr) => ({ status: 'ativa', recursos: { whatsapp: r }, plano_recursos: { whatsapp: pr } });
  assert.strictEqual(motivoIndisponivel(ad, st(false, false), 1, null), null);
  assert.match(motivoIndisponivel(ad, st(true, false), 1, null), /já está incluído/);
  assert.strictEqual(motivoIndisponivel(ad, st(true, false), 1, null, true), null);
  assert.match(motivoIndisponivel(ad, st(true, true), 1, null, true), /já está incluído/);
});

test('rotas de recurso usam exigeRecurso (WhatsApp, promocoes, campanhas, whatsapp do portal)', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require.resolve('../../server.js'), 'utf8');
  assert.match(server, /exigeRecurso\('whatsapp'\), whatsappRoutes/);
  assert.match(server, /exigeRecurso\('whatsapp'\), promocaoWhatsappRoutes/);
  assert.match(server, /exigeRecurso\('campanhas'\), campanhasRoutes/);
  assert.match(server, /verifyDownloadToken\('leads'\), exigeRecurso\('exportacao'\)/);
  const portal = fs.readFileSync(require.resolve('../../src/routes/portalRoutes.js'), 'utf8');
  assert.match(portal, /whatsapp-preview", exigeRecurso\("whatsapp"\)/);
  assert.match(portal, /whatsapp-teste", exigeRecurso\("whatsapp"\)/);
});
