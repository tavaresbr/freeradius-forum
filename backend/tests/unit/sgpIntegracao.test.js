const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('path');

// Banco simulado
const chamadas = [];
let existentes = [];
let cfgSalva = null;
const fakeDb = {
  query: async (sql, params) => {
    chamadas.push({ sql, params });
    return /^\s*SELECT/i.test(sql) ? [existentes] : [{ affectedRows: 1 }];
  },
  execute: async (sql, params) => {
    chamadas.push({ sql, params });
    if (/SELECT empresa_id FROM empresa_configs/.test(sql)) return [cfgSalva ? [{ empresa_id: 1 }] : []];
    if (/UPDATE empresa_configs SET config_json/.test(sql)) { cfgSalva = JSON.parse(params[0]); return [{ affectedRows: 1 }]; }
    if (/FROM empresa_configs/.test(sql)) return [cfgSalva ? [{ config_json: JSON.stringify(cfgSalva) }] : []];
    if (/INSERT INTO empresa_configs/.test(sql)) { cfgSalva = JSON.parse(params[1]); }
    return [{ affectedRows: 1 }];
  },
};
const dbPath = require.resolve(path.join(__dirname, '../../db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const sgp = require('../../src/utils/sgpClient');
const ctrl = require('../../src/controllers/integracaoController');

// ---- SGP falso: paginado, com objetos aninhados e credencial conferida ----
const CLIENTES = Array.from({ length: 250 }, (_, i) => ({
  id: 1000 + i,
  nome: `Cliente ${i}`,
  cpfcnpj: i === 0 ? '529.982.247-25' : i === 1 ? '168.995.350-09' : (i === 2 ? '123' : ''),
  email: `c${i}@exemplo.com`,
  celular: '(93) 99193-5695',
  endereco: { logradouro: 'Rua das Flores', numero: '10', cidade: 'Santarém', uf: 'PA', cep: '68000000' },
  contratos: [{ id: 1 }],
}));
let modo = 'ok';
let ultimoCorpo = null;
const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    ultimoCorpo = corpo ? JSON.parse(corpo) : {};
    const json = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (modo === 'naoencontrado') return json(404, {});
    if (modo === 'formato') return json(200, { erro: 'x', foo: 1 });
    if (modo === 'redirect') { res.writeHead(302, { location: 'https://outro' }); return res.end(); }
    if (ultimoCorpo.token !== 'tok123' || ultimoCorpo.app !== 'meuapp') return json(401, { erro: 'credenciais' });
    const { offset, limit } = ultimoCorpo;
    if (limit > 100) return json(400, { erro: '[limit]: max 100' });
    json(200, { clientes: CLIENTES.slice(offset, offset + limit) });
  });
});
let base;
// o SGP falso escuta em 127.0.0.1, que os guards de SSRF bloqueariam
const urlPermitidaOriginal = sgp.urlPermitida;
sgp.urlPermitida = () => true;
sgp.verificarDns = async () => true;

test.before(() => new Promise((ok) => servidor.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${servidor.address().port}`; ok(); })));
test.after(() => new Promise((ok) => servidor.close(ok)));

const cfg = () => ({ url: base, app: 'meuapp', token: 'tok123', endpoint: '/api/ura/clientes/' });

test('testar: devolve HTTP, campos achatados e mapeamento sem expor valores', async () => {
  modo = 'ok';
  const r = await sgp.testar(cfg());
  assert.strictEqual(r.http, 200);
  assert.strictEqual(r.registros, 100);   // 1a pagina
  assert.ok(r.campos.includes('endereco_cidade') && r.campos.includes('cidade'));
  assert.ok(!r.campos.includes('contratos'));
  assert.deepStrictEqual(r.identificou, { nome: true, documento: true });
  assert.strictEqual(r.mapeamento.cpf, 'cpfcnpj');
  assert.ok(!JSON.stringify(r).includes('529.982'));
});

test('buscarTodos pagina ate o fim e envia app/token/offset/limit', async () => {
  modo = 'ok';
  const todos = await sgp.buscarTodos(cfg());
  assert.strictEqual(todos.length, 250);
  assert.strictEqual(ultimoCorpo.offset, 200);
  assert.strictEqual(todos[0].endereco_cidade, 'Santarém');
});

test('amostra: consulta so 10 registros e mascara os dados pessoais', async () => {
  modo = 'ok';
  const a = await sgp.amostra(cfg());
  assert.strictEqual(a.length, 10);
  assert.strictEqual(ultimoCorpo.limit, 10);
  const txt = JSON.stringify(a);
  for (const proibido of ['529.982.247-25', 'c0@exemplo.com', '99193-5695', 'Rua das Flores', '68000000', 'Cliente 0']) {
    assert.ok(!txt.includes(proibido), proibido);
  }
  assert.match(a[0].cpfcnpj, /\*+25$/);
  assert.match(a[0].email, /^c0\*\*\*@exemplo\.com$/);
  assert.match(a[0].celular, /\*+5695$/);
  assert.strictEqual(a[0].endereco_uf, 'PA');
});

test('erros do SGP viram mensagens claras e nunca vazam o token', async () => {
  const ruim = { ...cfg(), token: 'errado' };
  await assert.rejects(sgp.testar(ruim), (e) => e instanceof sgp.SgpError && /credenciais/.test(e.message) && !e.message.includes('errado'));
  modo = 'naoencontrado';
  await assert.rejects(sgp.testar(cfg()), /Endpoint não encontrado/);
  modo = 'formato';
  await assert.rejects(sgp.testar(cfg()), /formato inesperado.*erro, foo/);
  modo = 'redirect';
  await assert.rejects(sgp.testar(cfg()), /redirecionou/);
  modo = 'ok';
  await assert.rejects(sgp.testar({ ...cfg(), url: 'http://127.0.0.1:1' }), /recusou a conexão|conectar/);
});

function resFalso() {
  const r = { statusCode: 200, corpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.corpo = o; return r; };
  return r;
}

test('controller: guard SSRF bloqueia localhost; salvar nao devolve token', async () => {
  chamadas.length = 0; cfgSalva = null;
  sgp.urlPermitida = urlPermitidaOriginal;
  test.after(() => { sgp.urlPermitida = () => true; });
  let res = resFalso();
  await ctrl.salvarSgp({ empresa_id: 1, body: { url: 'http://localhost:9', app: 'a', token: 't' } }, res);
  assert.strictEqual(res.statusCode, 400);
  res = resFalso();
  await ctrl.salvarSgp({ empresa_id: 1, body: { url: 'sgp.exemplo.com.br', app: 'a', token: 't' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(cfgSalva.url, 'https://sgp.exemplo.com.br');
  res = resFalso();
  await ctrl.obterSgp({ empresa_id: 1 }, res);
  assert.deepStrictEqual(Object.keys(res.corpo).sort(), ['app', 'configurado', 'endpoint', 'sync_auto', 'sync_horas', 'token_definido', 'ultima_sync', 'url']);
  assert.ok(!JSON.stringify(res.corpo).includes('"t"'));
  // token em branco mantem o salvo
  res = resFalso();
  await ctrl.salvarSgp({ empresa_id: 1, body: { url: 'https://sgp.exemplo.com.br', app: 'b', token: '' } }, res);
  assert.strictEqual(cfgSalva.token, 't');
  // sem config valida, testar/importar pedem para salvar primeiro; destino interno salvo antes e bloqueado
  cfgSalva = { url: 'http://127.0.0.1:1', app: 'a', token: 't' };
  res = resFalso();
  await ctrl.testarSgp({ empresa_id: 1 }, res);
  assert.strictEqual(res.statusCode, 400);
  cfgSalva = null;
  res = resFalso();
  await ctrl.importarSgp({ empresa_id: 1, body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('importacao ponta a ponta contra o SGP falso: simula e grava, preenchendo so vazios', async () => {
  modo = 'ok';
  const imp = require('../../src/utils/importCadastros');
  existentes = [{ id: 9, cpf_l: '52998224725', cnpj_l: null }];
  chamadas.length = 0;
  const linhas = await sgp.buscarTodos(cfg());
  const mapa = imp.sugerirMapeamento([...new Set(linhas.flatMap((l) => Object.keys(l)))]);
  const sim = await imp.processarImportacao(linhas, mapa, 7, { sistemaOrigem: 'sgp', dryRun: true });
  assert.deepStrictEqual([sim.criados, sim.atualizados], [1, 1]);   // i=0 existe, i=1 novo
  assert.strictEqual(sim.erros.length, 248);                        // i=2 CPF "123" + 247 sem documento
  assert.ok(sim.erros.some((e) => e.motivo === 'CPF inválido'));
  assert.ok(!chamadas.some((c) => /INSERT|UPDATE/.test(c.sql)));
  const real = await imp.processarImportacao(linhas, mapa, 7, { sistemaOrigem: 'sgp' });
  assert.strictEqual(real.criados, 1);
  const ins = chamadas.find((c) => /INSERT INTO leads/.test(c.sql));
  assert.ok(ins.params[0][0].includes('sgp'));
  const upd = chamadas.find((c) => /UPDATE leads/.test(c.sql));
  assert.match(upd.sql, /COALESCE\(NULLIF/);
});

test('syncSgp: so roda para sync_auto vencida e registra o resultado sem expor token', async () => {
  modo = 'ok';
  existentes = [];
  const syncSgp = require('../../src/jobs/syncSgp');
  const base = { ...cfg(), sync_auto: true, sync_horas: 24 };
  const urlPermitidaReal = sgp.urlPermitida;
  const verificarDnsReal = sgp.verificarDns;
  sgp.verificarDns = async () => true;
  sgp.urlPermitida = () => true;   // o SGP falso escuta em 127.0.0.1, que o guard SSRF bloquearia
  test.after(() => { sgp.urlPermitida = urlPermitidaReal; sgp.verificarDns = verificarDnsReal; });

  cfgSalva = { ...base, sync_auto: false };                       // desligada: nao roda
  await syncSgp();
  assert.strictEqual(cfgSalva.ultima_sync, undefined);

  const recente = new Date(Date.now() - 3600 * 1000).toISOString();
  cfgSalva = { ...base, ultima_sync: { em: recente, ok: true } };  // dentro do prazo: nao roda
  await syncSgp();
  assert.strictEqual(cfgSalva.ultima_sync.em, recente);

  cfgSalva = { ...base, ultima_sync: { em: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), ok: true } };
  await syncSgp();                                                 // vencida: roda
  assert.strictEqual(cfgSalva.ultima_sync.ok, true);
  assert.strictEqual(cfgSalva.ultima_sync.total, 250);
  assert.strictEqual(cfgSalva.token, 'tok123');                    // config preservada

  cfgSalva = { ...base, token: 'errado' };                         // SGP recusa: registra erro, sem token
  await syncSgp();
  assert.strictEqual(cfgSalva.ultima_sync.ok, false);
  assert.ok(!JSON.stringify(cfgSalva.ultima_sync).includes('errado'));
});

test('salvarConfig: sync_auto/sync_horas so mudam quando enviados; horas fora da faixa voltam ao padrao', async () => {
  cfgSalva = { url: 'https://x.com', app: 'a', token: 't', sync_auto: true, sync_horas: 6 };
  await sgp.salvarConfig(1, { url: 'https://x.com', app: 'a', token: '' });
  assert.strictEqual(cfgSalva.sync_auto, true);
  assert.strictEqual(cfgSalva.sync_horas, 6);
  await sgp.salvarConfig(1, { url: 'https://x.com', app: 'a', token: '', sync_auto: false, sync_horas: 9999 });
  assert.strictEqual(cfgSalva.sync_auto, false);
  assert.strictEqual(cfgSalva.sync_horas, 24);
});

test('SSRF: faixas internas, IPv6 mapeado e formas numericas exoticas sao bloqueadas', () => {
  for (const ip of ['10.0.0.1', '172.20.1.1', '192.168.0.9', '100.64.0.5', '169.254.169.254', '127.1.2.3', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '0.0.0.0']) {
    assert.strictEqual(sgp.ipInterno(ip), true, ip);
  }
  assert.strictEqual(sgp.ipInterno('8.8.8.8'), false);
  for (const u of ['http://10.8.0.2/', 'http://[::ffff:7f00:1]/', 'http://0x7f.1/', 'http://2130706433/', 'https://u:p@sgp.exemplo.com/', 'http://srv.internal/']) {
    assert.strictEqual(urlOriginalPermitida(u), false, u);
  }
  assert.strictEqual(urlOriginalPermitida('https://sgp.exemplo.com.br'), true);
});
const urlOriginalPermitida = (u) => urlPermitidaOriginal(u);
