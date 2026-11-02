// Grupos do WhatsApp por numero: parsers tolerantes, previa, importacao com origem e escopo por numero/empresa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const axios = require('axios');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const g = require('../../src/utils/whatsappGrupos');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };
const cfg = JSON.stringify({ api_url: 'http://evo', api_key: 'k', instance_name: 'empresa_7' });

test('parsers: grupo, participante (@lid sem numero), etiqueta <= 40, dedupe', () => {
  assert.strictEqual(g.normalizarGrupo({ id: '123@s.whatsapp.net' }), null);
  assert.deepStrictEqual(g.normalizarGrupo({ id: '1@g.us', subject: ' Time  A ', size: 3 }), { jid: '1@g.us', nome: 'Time A', tamanho: 3 });
  assert.strictEqual(g.normalizarParticipante({ id: '5511999990000@s.whatsapp.net', admin: 'admin' }).telefone, '5511999990000');
  assert.strictEqual(g.normalizarParticipante({ id: '999@lid', phoneNumber: '5511988887777@s.whatsapp.net' }).telefone, '5511988887777');
  const lid = g.normalizarParticipante({ id: '999@lid' });
  assert.strictEqual(lid.telefone, null); assert.strictEqual(lid.lid, true);
  assert.ok(g.nomeEtiqueta('x'.repeat(100)).length <= 40);
  const m = g.separarMembros([{ id: '5511999990000@s.whatsapp.net' }, { id: '11999990000@s.whatsapp.net' }, { id: '1@lid' }]);
  assert.strictEqual(m.telefones.length, 1); assert.strictEqual(m.semNumero, 1);
});

function montar({ leadsExistentes = [] } = {}) {
  limpar();
  const db = criarDb(async (sql, p) => {
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: cfg }]];
    if (/FROM whatsapp_numeros WHERE id = \? AND empresa_id = \?/.test(sql)) return p[0] === 3 && p[1] === 7 ? [[{ id: 3, nome: 'Fin', instance_name: 'empresa_7_n3' }]] : [[]];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM leads WHERE empresa_id = \? AND telefone_fim10 IN/.test(sql)) return [leadsExistentes.map((f10, i) => ({ id: 100 + i, f10 }))];
    if (/FROM whatsapp_etiquetas WHERE/.test(sql)) return [[{ id: 9 }]];
  });
  const svc = carregar('src/services/whatsappGrupos.js', { db });
  return { db, svc };
}
const chamadas = [];
function falsoAxios() {
  const orig = axios.get;
  axios.get = async (url) => {
    chamadas.push(url);
    if (/fetchAllGroups/.test(url)) return { data: [{ id: 'A@g.us', subject: 'Grupo A', size: 3 }] };
    return { data: { participants: [{ id: '5511999990000@s.whatsapp.net' }, { id: '5511888880000@s.whatsapp.net' }, { id: '77@lid' }] } };
  };
  return () => { axios.get = orig; };
}

test('previa e importacao: so novos viram lead, grupo/numero gravados, sem CPF, etiqueta criada', async () => {
  const { db, svc } = montar({ leadsExistentes: ['1999990000'] });
  const volta = falsoAxios();
  try {
    const p = await svc.previa(7, 3, 'A@g.us');
    assert.deepStrictEqual([p.com_numero, p.sem_numero, p.ja_cadastrados, p.novos], [2, 1, 1, 1]);
    assert.ok(chamadas.every((u) => u.includes('empresa_7_n3')));   // sempre a instancia do numero escolhido
    const r = await svc.importar(7, 3, 'A@g.us');
    assert.strictEqual(r.criados, 1); assert.strictEqual(r.ja_existiam, 1); assert.strictEqual(r.etiqueta, 'Grupo: Grupo A');
    const ins = db.calls.find((c) => /INSERT INTO leads \(/.test(c.sql));
    assert.ok(!/cpf/i.test(ins.sql)); assert.ok(ins.sql.includes('lgpd_aceite'));
    assert.strictEqual(ins.params[0][0][6], 0);                       // lgpd_aceite = 0
    assert.ok(db.calls.some((c) => /INSERT IGNORE INTO leads_origem_grupo/.test(c.sql) && c.params[0][0][2] === 3));
    assert.ok(db.calls.filter((c) => /^SELECT .* FROM leads WHERE/.test(c.sql)).every((c) => c.params[0] === 7));
  } finally { volta(); }
});

test('numero de outra empresa e grupo inexistente sao recusados; nao cai no principal', async () => {
  const { svc } = montar();
  const volta = falsoAxios();
  try {
    await assert.rejects(() => svc.listarGrupos(8, 3), (e) => e.code === 'NUMERO_WHATSAPP_INVALIDO');
    await assert.rejects(() => svc.previa(7, 3, 'ZZ@g.us'), (e) => e.status === 404);
    await assert.rejects(() => svc.previa(7, 3, 'x@s.whatsapp.net'), (e) => e.status === 400);
  } finally { volta(); }
});

test('controller: importar exige confirmar; sem migration responde 503', async () => {
  limpar();
  const db = criarDb(async (sql) => {
    if (/leads_origem_grupo LIMIT 1/.test(sql)) throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' });
    if (/FROM empresa_configs/.test(sql)) return [[{ config_json: cfg }]];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/telefone_fim10 IN/.test(sql)) return [[]];
  });
  const c = carregar('src/controllers/atendimentoGruposController.js', { db });
  const volta = falsoAxios();
  try {
    let res = criarRes();
    await c.importar(criarReq({ empresa_id: 7, params: { jid: 'A@g.us' }, body: {} }), res);
    assert.strictEqual(res.statusCode, 400);
    res = criarRes();
    await c.importar(criarReq({ empresa_id: 7, params: { jid: 'A@g.us' }, body: { confirmar: true } }), res);
    assert.strictEqual(res.statusCode, 503);
    assert.match(res.body.error, /076/);
  } finally { volta(); }
});
