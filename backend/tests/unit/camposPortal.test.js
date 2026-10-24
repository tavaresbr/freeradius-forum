const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Banco simulado: registra tudo e responde conforme a config do portal definida no teste.
const chamadas = [];
let configPortal = null;   // string JSON, objeto ou null
let falharConfig = false;
const responder = async (sql, params) => {
  chamadas.push({ sql, params });
  if (/FROM planos/.test(sql)) return [[undefined]];   // sem plano LGPD: o fluxo para aqui com 404
  if (/JOIN mikrotiks/.test(sql)) {
    if (falharConfig) throw new Error('banco fora');
    return [[configPortal === null ? undefined : { configuracoes: configPortal }]];
  }
  if (/FROM mikrotiks WHERE id/.test(sql)) return [[{ empresa_id: 7 }]];
  return [[undefined]];
};
const fakeDb = { execute: responder, query: responder };
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const { CAMPOS_PADRAO, normalizarCampos, validarCampos, emailValido } = require('../../src/utils/camposPortal');
const { resolverCamposPortal, resolverTextoLgpd, TEXTO_LGPD_DEFAULT } = require('../../src/utils/leadUtils');
const { lgpdLogin, lgpdCadastro } = require('../../src/controllers/lgpdController');

function resFalso() {
  const r = { statusCode: 200, corpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.corpo = o; return r; };
  return r;
}
function reset(cfg = null) { chamadas.length = 0; configPortal = cfg; falharConfig = false; }
const escritas = () => chamadas.filter((c) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(c.sql));
const base = { aceite: true, mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.5', mikrotik_id: 3, cpf: '529.982.247-25' };

test('normalizarCampos: padroes, mescla, booleanos e campo oculto', () => {
  assert.deepStrictEqual(normalizarCampos(undefined), CAMPOS_PADRAO);
  assert.deepStrictEqual(normalizarCampos('lixo'), CAMPOS_PADRAO);
  assert.deepStrictEqual(normalizarCampos([]), CAMPOS_PADRAO);
  const r = normalizarCampos({ email: { obrigatorio: true }, nome: { visivel: false, obrigatorio: true }, telefone: { visivel: 'sim', obrigatorio: 1 }, cpf: { visivel: false }, extra: {} });
  assert.deepStrictEqual(r.email, { visivel: true, obrigatorio: true });
  assert.deepStrictEqual(r.nome, { visivel: false, obrigatorio: false });   // oculto nunca e' obrigatorio
  assert.deepStrictEqual(r.telefone, CAMPOS_PADRAO.telefone);               // nao-booleanos ignorados
  assert.strictEqual(r.cpf, undefined);                                     // CPF nao e' configuravel
  assert.strictEqual(r.extra, undefined);
});

test('emailValido', () => {
  for (const e of ['a@b.co', 'joao.silva+x@dominio.com.br']) assert.strictEqual(emailValido(e), true, e);
  for (const e of ['', 'sem-arroba', 'a@b', 'a @b.com', 'a@b.c', undefined, 123, 'a@' + 'x'.repeat(260) + '.com']) assert.strictEqual(emailValido(e), false, String(e));
});

test('validarCampos: obrigatorios, formato do e-mail e campos ocultos', () => {
  const obrig = normalizarCampos({ nome: { obrigatorio: true }, email: { obrigatorio: true }, telefone: { obrigatorio: true } });
  assert.strictEqual(validarCampos(obrig, {}), 'Informe seu nome completo');
  assert.strictEqual(validarCampos(obrig, { nome: 'Ana Souza' }), 'Informe seu e-mail');
  assert.strictEqual(validarCampos(obrig, { nome: 'Ana Souza', email: 'ana@x.com' }), 'Informe um telefone válido com DDD');
  assert.strictEqual(validarCampos(obrig, { nome: 'Ana Souza', email: 'ana@x.com', telefone: '(11) 9999' }), 'Informe um telefone válido com DDD');
  assert.strictEqual(validarCampos(obrig, { nome: 'Ana Souza', email: 'ana@x.com', telefone: '(11) 99999-0000' }), null);
  assert.strictEqual(validarCampos(obrig, { nome: '   ', email: 'ana@x.com', telefone: '11999990000' }), 'Informe seu nome completo');
  assert.strictEqual(validarCampos(obrig, { nome: ['Ana'], email: { a: 1 }, telefone: 11999990000 }), 'Informe seu nome completo');
  // opcional: vazio passa, mas e-mail preenchido errado nao
  assert.strictEqual(validarCampos(CAMPOS_PADRAO, {}), null);
  assert.strictEqual(validarCampos(CAMPOS_PADRAO, { email: 'errado' }), 'E-mail inválido');
  // oculto: ignora tudo, inclusive e-mail invalido enviado por fora
  const oculto = normalizarCampos({ email: { visivel: false, obrigatorio: true } });
  assert.strictEqual(validarCampos(oculto, { email: 'errado' }), null);
});

test('resolverCamposPortal: config valida, sem config, JSON quebrado e banco fora', async () => {
  reset(JSON.stringify({ campos: { email: { obrigatorio: true } } }));
  assert.strictEqual((await resolverCamposPortal({ mikrotikId: 3, empresaId: 7 })).email.obrigatorio, true);
  reset(null);
  assert.deepStrictEqual(await resolverCamposPortal({ mikrotikId: 3, empresaId: 7 }), CAMPOS_PADRAO);
  reset('{json quebrado');
  assert.deepStrictEqual(await resolverCamposPortal({ mikrotikId: 3, empresaId: 7 }), CAMPOS_PADRAO);
  reset(JSON.stringify({}));
  falharConfig = true;
  assert.deepStrictEqual(await resolverCamposPortal({ mikrotikId: 3, empresaId: 7 }), CAMPOS_PADRAO);
});

test('resolverTextoLgpd continua igual depois do refactor', async () => {
  reset(JSON.stringify({ texto_lgpd: 'Meu termo' }));
  assert.strictEqual(await resolverTextoLgpd({ mikrotikId: 3, empresaId: 7 }), 'Meu termo');
  reset(null);
  assert.strictEqual(await resolverTextoLgpd({ mikrotikId: 3, empresaId: 7 }), TEXTO_LGPD_DEFAULT);
  reset('{json quebrado');
  assert.strictEqual(await resolverTextoLgpd({ mikrotikId: 3, empresaId: 7 }), TEXTO_LGPD_DEFAULT);
});

for (const [nome, handler] of [['lgpdLogin', lgpdLogin], ['lgpdCadastro', lgpdCadastro]]) {
  test(`${nome}: campo obrigatorio faltando da 400 antes de qualquer escrita`, async () => {
    reset(JSON.stringify({ campos: { email: { obrigatorio: true }, nome: { obrigatorio: true } } }));
    let res = resFalso();
    await handler({ body: { ...base, nome: 'Ana Souza' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.corpo, { message: 'Informe seu e-mail' });
    assert.strictEqual(escritas().length, 0);
    reset(JSON.stringify({ campos: { email: { obrigatorio: true } } }));
    res = resFalso();
    await handler({ body: { ...base, nome: 'Ana Souza', email: 'invalido' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.corpo, { message: 'E-mail inválido' });
    assert.strictEqual(escritas().length, 0);
  });
}

test('lgpdLogin: com os campos preenchidos (ou nao obrigatorios) a validacao passa e o fluxo segue', async () => {
  reset(JSON.stringify({ campos: { email: { obrigatorio: true } } }));
  let res = resFalso();
  await lgpdLogin({ body: { ...base, nome: 'Ana', email: 'ana@x.com' } }, res);
  assert.strictEqual(res.statusCode, 404);   // passou da validacao; parou no "Plano LGPD nao configurado" do stub
  reset(null);                                // portal sem config = padroes: nada obrigatorio
  res = resFalso();
  await lgpdLogin({ body: { ...base } }, res);
  assert.strictEqual(res.statusCode, 404);
  reset(JSON.stringify({ campos: { email: { obrigatorio: true } } }));
  falharConfig = true;                        // banco fora ao ler a config: usa padroes, nao bloqueia
  res = resFalso();
  await lgpdLogin({ body: { ...base } }, res);
  assert.strictEqual(res.statusCode, 404);
});

// ---- atualizarPortal: higieniza configuracoes.campos antes de gravar
const { atualizarPortal } = require('../../src/controllers/portalController');

async function salvarComo(configuracoes) {
  chamadas.length = 0;
  const original = fakeDb.execute;
  fakeDb.execute = async (sql, params) => { chamadas.push({ sql, params }); return [{ affectedRows: 1 }]; };
  const origQuery = fakeDb.query;
  fakeDb.query = async (sql) => (/FROM portais WHERE id/.test(sql) ? [[{ id: 11, nome: 'LGPD', configuracoes: '{"titulo":"X"}', whatsapp_enabled: 0 }]] : [[undefined]]);
  const res = resFalso();
  try {
    await atualizarPortal({ params: { id: 11 }, empresa_id: 1, body: { configuracoes } }, res);
  } finally { fakeDb.execute = original; fakeDb.query = origQuery; }
  const upd = chamadas.find((c) => /UPDATE portais SET/.test(c.sql));
  const json = upd && upd.params.find((p) => typeof p === 'string' && p.startsWith('{') && p.endsWith('}'));
  return { res, gravado: json ? JSON.parse(json) : null };
}

test('atualizarPortal: campos enviados pelo editor sao higienizados (objeto e string JSON)', async () => {
  const sujo = { titulo: 'Novo', campos: { email: { visivel: false, obrigatorio: true }, nome: { obrigatorio: 'sim' }, telefone: { obrigatorio: true }, cpf: { visivel: false }, x: 1 } };
  for (const entrada of [sujo, JSON.stringify(sujo)]) {
    const { res, gravado } = await salvarComo(entrada);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(gravado.titulo, 'Novo');                                          // resto da config intacto
    assert.deepStrictEqual(gravado.campos.email, { visivel: false, obrigatorio: false }); // oculto nunca obrigatorio
    assert.deepStrictEqual(gravado.campos.nome, { visivel: true, obrigatorio: false });   // nao booleano ignorado
    assert.deepStrictEqual(gravado.campos.telefone, { visivel: true, obrigatorio: true });
    assert.strictEqual(gravado.campos.cpf, undefined);
    assert.strictEqual(gravado.campos.x, undefined);
  }
});

test('atualizarPortal: config sem campos segue como antes (nao inventa campos)', async () => {
  const { res, gravado } = await salvarComo({ titulo: 'So titulo' });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(gravado, { titulo: 'So titulo' });
});
