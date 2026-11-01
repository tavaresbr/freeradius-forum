// Hub WhatsApp (aba Contatos e Modelos): escopo por empresa, dedupe, sem CPF, categorias de modelo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const mm = require('../../src/utils/modelosMensagem');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };

test('modelosMensagem: categoria invalida cai em geral; modelos padrao tem atalho valido e categoria conhecida', () => {
  assert.strictEqual(mm.categoriaValida('cobranca'), 'cobranca');
  assert.strictEqual(mm.categoriaValida('hack'), 'geral');
  assert.strictEqual(mm.categoriaValida(undefined), 'geral');
  assert.strictEqual(mm.categoriaValida('__proto__'), 'geral');
  const atalhos = new Set();
  for (const m of mm.MODELOS_PADRAO) {
    assert.match(m.atalho, /^[a-z0-9_-]{1,30}$/);
    assert.ok(m.categoria in mm.CATEGORIAS);
    assert.ok(m.texto.length > 10 && m.texto.length <= 1000);
    assert.ok(!atalhos.has(m.atalho)); atalhos.add(m.atalho);
  }
});

function contatos({ rows = [], colunaGerada = true } = {}) {
  limpar();
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: colunaGerada ? 1 : 0 }]];
    if (/FROM whatsapp_conversa_etiquetas ce/.test(sql)) return [[{ conversa_id: 5, id: 1, nome: 'VIP', cor: '#ff0000' }]];
    if (/UNION ALL/.test(sql)) return [rows];
  });
  const ctrl = carregar('src/controllers/atendimentoContatosController.js', { db });
  return { db, ctrl };
}
const linha = (o = {}) => ({ origem: 'conversa', conversa_id: 5, lead_id: 9, nome: 'Maria', telefone: '5593988887777', atividade: new Date(), nao_lidas: 2, status_conversa: 'aberta', optout: 0, cpf: '52998224725', ...o });

test('contatos: escopa as duas partes por empresa_id, nao devolve CPF e anexa etiquetas das conversas', async () => {
  const { db, ctrl } = contatos({ rows: [linha(), linha({ origem: 'lead', conversa_id: null, nome: 'Joao', telefone: '93977776666', nao_lidas: 0, status_conversa: null })] });
  const res = criarRes();
  await ctrl.listarContatos(criarReq({ empresa_id: 7, query: {} }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.contatos.length, 2);
  assert.ok(!JSON.stringify(res.body).includes('52998224725'), 'CPF nunca sai');
  assert.deepStrictEqual(res.body.contatos[0].etiquetas, [{ id: 1, nome: 'VIP', cor: '#ff0000' }]);
  assert.deepStrictEqual(res.body.contatos[1].etiquetas, []);
  const q = db.calls.find((c) => /UNION ALL/.test(c.sql));
  assert.match(q.sql, /c\.empresa_id = \?/);
  assert.match(q.sql, /l\.empresa_id = \?/);
  assert.match(q.sql, /l\.telefone_fim10/, 'usa a coluna gerada quando existe');
  assert.deepStrictEqual(q.params.slice(0, 2), [7, 7]);
});

test('contatos: sem a coluna gerada usa a expressao antiga qualificada; filtros viram placeholders; pagina limita a 50', async () => {
  const muitos = Array.from({ length: 51 }, (_, i) => linha({ conversa_id: i + 1, lead_id: i + 1 }));
  const { db, ctrl } = contatos({ rows: muitos, colunaGerada: false });
  const res = criarRes();
  await ctrl.listarContatos(criarReq({ empresa_id: 7, query: { q: "x'; DROP--", optout: '1', origem: 'conversas', etiqueta: '3', pagina: '2' } }), res);
  assert.strictEqual(res.body.contatos.length, 50);
  assert.strictEqual(res.body.tem_mais, true);
  const q = db.calls.find((c) => /UNION ALL/.test(c.sql));
  assert.match(q.sql, /REGEXP_REPLACE\(l\.telefone/);
  assert.ok(!q.sql.includes('DROP'), 'texto digitado nunca entra no SQL');
  assert.match(q.sql, /t\.optout = 1/);
  assert.match(q.sql, /t\.origem = 'conversa'/);
  assert.deepStrictEqual(q.params.slice(-2), [51, 50]);
  assert.ok(q.params.includes(3) && q.params.includes(7));
});

test('modelos: listar devolve categorias; criar grava categoria validada; padrao e idempotente (INSERT IGNORE)', async () => {
  limpar();
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM whatsapp_respostas_rapidas/.test(sql) && /^SELECT/.test(sql)) return [[{ id: 1, atalho: 'ola', titulo: 'Ola', texto: 'x', categoria: 'geral' }]];
    if (/(INSERT IGNORE )?INTO whatsapp_respostas_rapidas/.test(sql) && /IGNORE|DUPLICATE/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO whatsapp_respostas_rapidas/.test(sql)) return [{ insertId: 4 }];
  });
  const ctrl = carregar('src/controllers/atendimentoExtrasController.js', { db });
  let res = criarRes();
  await ctrl.listarRespostas(criarReq({ empresa_id: 7 }), res);
  assert.strictEqual(res.body.respostas[0].categoria, 'geral');
  assert.ok(res.body.categorias.cobranca);
  res = criarRes();
  await ctrl.criarResposta(criarReq({ empresa_id: 7, body: { atalho: 'renova', titulo: 'Renovar', texto: 'Oi {{nome}}', categoria: 'cobranca' } }), res);
  assert.strictEqual(res.body.success, true);
  const ins = db.calls.find((c) => /^INSERT INTO whatsapp_respostas_rapidas/.test(c.sql));
  assert.deepStrictEqual(ins.params, [7, 'renova', 'Renovar', 'Oi {{nome}}', 'cobranca']);
  res = criarRes();
  await ctrl.criarResposta(criarReq({ empresa_id: 7, body: { atalho: 'abc', titulo: 'T', texto: 'x', categoria: 'xx' } }), res);
  assert.strictEqual(db.calls.filter((c) => /^INSERT INTO whatsapp_respostas_rapidas/.test(c.sql)).pop().params[4], 'geral');
  res = criarRes();
  await ctrl.criarModelosPadrao(criarReq({ empresa_id: 7 }), res);
  assert.strictEqual(res.body.criados, mm.MODELOS_PADRAO.length);
  assert.ok(db.calls.filter((c) => /IGNORE|DUPLICATE/.test(c.sql)).every((c) => c.params[0] === 7));
});
