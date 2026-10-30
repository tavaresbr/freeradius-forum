// Indicacoes: config, antifraude (pura), resolucao do desconto no servidor, vinculo ao pagamento, recompensa unica e controller.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const ind = require('../../src/utils/indicacoes');

const ROOT = path.resolve(__dirname, '..', '..');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k]; };

test('validarConfig: descontos, limites, mensagem com {{codigo}}; padrao desligado', () => {
  const ok = ind.validarConfig({ ativo: true, desconto_indicado: { tipo: 'percentual', valor: 15 }, recompensa_indicador: { tipo: 'valor', valor: 500 }, limite_por_indicador_mes: 3 });
  assert.strictEqual(ok.desconto_indicado.valor, 15);
  assert.strictEqual(ok.validade_cupom_dias, 30);
  assert.strictEqual(ok.exigir_compra_do_indicador, true);
  const base = { desconto_indicado: { tipo: 'percentual', valor: 10 }, recompensa_indicador: { tipo: 'percentual', valor: 10 } };
  assert.throws(() => ind.validarConfig({ ...base, desconto_indicado: { tipo: 'percentual', valor: 100 } }), /1% a 99%/);
  assert.throws(() => ind.validarConfig({ ...base, recompensa_indicador: { tipo: 'x', valor: 5 } }), /tipo inválido/);
  assert.throws(() => ind.validarConfig({ ...base, limite_por_indicador_mes: 0 }), /Limite/);
  assert.throws(() => ind.validarConfig({ ...base, validade_cupom_dias: 400 }), /Validade/);
  assert.throws(() => ind.validarConfig({ ...base, mensagem_convite: 'sem codigo aqui' }), /\{\{codigo\}\}/);
  assert.strictEqual(ind.mesclarComPadrao(undefined).ativo, false);
});

test('gerarCodigo: IND + 6 caracteres sem ambiguos, no formato dos cupons', () => {
  for (let i = 0; i < 50; i++) assert.match(ind.gerarCodigo(), /^IND[A-HJKMNP-Z2-9]{6}$/);
  assert.match(ind.gerarCodigo(), /^[A-Z0-9]{3,32}$/);
});

const cfgOn = ind.mesclarComPadrao({ ativo: true });
const ctx = (o = {}) => ({
  cfg: cfgOn, indicador: { cpf: '11144477735', telefone: '93911112222', mac: 'AA:BB:CC:DD:EE:01' },
  indicado: { cpf: '52998224725', telefone: '93933334444', mac: 'AA:BB:CC:DD:EE:02' },
  jaComprou: false, jaIndicado: false, usadasMes: 0, indicadorEhCliente: true, ...o,
});

test('decidirIndicacao: aceita o caso normal e recusa cada fraude/regra com motivo proprio', () => {
  assert.deepStrictEqual(ind.decidirIndicacao(ctx()), { ok: true });
  const m = (o) => ind.decidirIndicacao(ctx(o)).motivo;
  assert.strictEqual(m({ cfg: { ...cfgOn, ativo: false } }), 'programa_desligado');
  assert.strictEqual(m({ indicado: { cpf: '', telefone: '1', mac: '' } }), 'sem_cpf');
  assert.strictEqual(m({ jaComprou: true }), 'nao_e_primeira_compra');
  assert.strictEqual(m({ jaIndicado: true }), 'cpf_ja_indicado');
  assert.strictEqual(m({ indicado: { cpf: '111.444.777-35', telefone: '9', mac: '' } }), 'auto_indicacao_cpf');
  assert.strictEqual(m({ indicado: { cpf: '52998224725', telefone: '+55 (93) 91111-2222', mac: '' } }), 'auto_indicacao_telefone');
  assert.strictEqual(m({ indicado: { cpf: '52998224725', telefone: '9', mac: 'aa-bb-cc-dd-ee-01' } }), 'auto_indicacao_aparelho');
  assert.strictEqual(m({ indicadorEhCliente: false }), 'indicador_sem_compra');
  assert.strictEqual(ind.decidirIndicacao(ctx({ indicadorEhCliente: false, cfg: { ...cfgOn, exigir_compra_do_indicador: false } })).ok, true);
  assert.strictEqual(m({ usadasMes: 5 }), 'limite_mensal');
  assert.strictEqual(ind.decidirIndicacao(ctx({ usadasMes: 4 })).ok, true);
});

// ---------- servico ----------
const plano = { id: 2, empresa_id: 7, valor: 5000 };
function servico(o = {}) {
  limpar();
  const { cfg = { ativo: true }, codigo = { id: 1, lead_id: 10 }, indicador = { id: 10, cpf: '11144477735', telefone: '93911112222', mac: 'AA:BB:CC:DD:EE:01' }, comprou = false, indicado = false, mes = 0, indicadorCliente = true, colunas = true } = o;
  const db = criarDb(async (sql, params) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: colunas ? 1 : 0 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ indicacoes: cfg }) }]];
    if (/FROM indicacoes_codigos WHERE empresa_id = \? AND codigo/.test(sql)) return [codigo ? [codigo] : []];
    if (/FROM leads WHERE id = \? AND empresa_id = \?/.test(sql)) return [[params[0] === 10 ? indicador : { telefone: '93933334444', mac: 'AA:BB:CC:DD:EE:02' }]];
    if (/FROM pagamentos WHERE empresa_id = \? AND status IN/.test(sql)) return [(params[1] === '52998224725' ? comprou : indicadorCliente) ? [{ id: 1 }] : []];
    if (/FROM indicacoes WHERE empresa_id = \? AND indicado_cpf/.test(sql)) return [indicado ? [{ id: 1 }] : []];
    if (/SELECT COUNT\(\*\) AS n FROM indicacoes/.test(sql)) return [[{ n: mes }]];
  });
  return { db, svc: carregar('src/services/indicacoes.js', { db }) };
}
const pedido = { empresaId: 7, plano, codigo: 'INDABC234', cpf: '529.982.247-25', mac: 'AA:BB:CC:DD:EE:02', clienteId: 55 };

test('resolverIndicacao: desconto calculado no servidor (config), nunca valor do cliente; recusa sem motivo publico', async () => {
  const s = servico();
  const r = await s.svc.resolverIndicacao(pedido);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.valor_original, r.desconto, r.valor_final], [5000, 500, 4500]);
  assert.strictEqual(r.cupom, null);
  assert.deepStrictEqual(r.indicacao, { codigo_id: 1, indicador_lead_id: 10 });
  for (const q of s.db.calls.filter((c) => /FROM (indicacoes_codigos|indicacoes|leads)/.test(c.sql))) assert.strictEqual(q.params[0] === 7 || q.params[0] === 10 || q.params[0] === 55, true);
  assert.deepStrictEqual(await servico({ cfg: { ativo: false } }).svc.resolverIndicacao(pedido), { ok: false });
  assert.deepStrictEqual(await servico({ codigo: null }).svc.resolverIndicacao(pedido), { ok: false });
  assert.deepStrictEqual(await servico({ comprou: true }).svc.resolverIndicacao(pedido), { ok: false }, 'so a 1a compra');
  assert.deepStrictEqual(await servico({ indicado: true }).svc.resolverIndicacao(pedido), { ok: false }, 'CPF ja indicado');
  assert.deepStrictEqual(await servico({ mes: 5 }).svc.resolverIndicacao(pedido), { ok: false }, 'teto mensal');
  assert.deepStrictEqual(await servico({}).svc.resolverIndicacao({ ...pedido, cpf: '' }), { ok: false }, 'sem CPF');
  assert.deepStrictEqual(await servico({}).svc.resolverIndicacao({ ...pedido, cpf: '11144477735' }), { ok: false }, 'auto-indicacao por CPF');
  assert.deepStrictEqual(await servico({}).svc.resolverIndicacao({ ...pedido, mac: 'aa-bb-cc-dd-ee-01' }), { ok: false }, 'auto-indicacao pelo aparelho');
  assert.deepStrictEqual(await servico({}).svc.resolverIndicacao({ ...pedido, empresaId: 8 }), { ok: false }, 'plano de outra empresa');
  assert.deepStrictEqual(await servico({ colunas: false }).svc.resolverIndicacao(pedido), { ok: false }, 'sem migration');
});

test('vincularPagamento: grava a indicacao pendente do pagamento (INSERT IGNORE) e liga em pagamentos.indicacao_id', async () => {
  limpar();
  const db = criarDb(async (sql) => {
    if (/SELECT empresa_id FROM pagamentos/.test(sql)) return [[{ empresa_id: 7 }]];
    if (/SELECT id FROM indicacoes WHERE pagamento_id/.test(sql)) return [[{ id: 31 }]];
    if (/^INSERT IGNORE INTO indicacoes/.test(sql)) return [{ affectedRows: 1 }];
  });
  const svc = carregar('src/services/indicacoes.js', { db });
  await svc.vincularPagamento(900, { indicacao: { codigo_id: 1, indicador_lead_id: 10 }, valor_original: 5000 }, '529.982.247-25');
  const ins = db.calls.find((c) => /^INSERT IGNORE INTO indicacoes/.test(c.sql));
  assert.deepStrictEqual(ins.params, [7, 1, 10, '52998224725', 900]);
  const up = db.calls.find((c) => /^UPDATE pagamentos SET indicacao_id/.test(c.sql));
  assert.deepStrictEqual(up.params, [31, 5000, 900, 7]);
});

function aprovacao({ claim = 1, mes = 0, cfg = { ativo: true }, dup = 0, indicacaoId = 31 } = {}) {
  limpar();
  const enviados = [];
  let dupRestante = dup;
  const db = criarDb(async (sql) => {
    if (/SELECT empresa_id, indicacao_id FROM pagamentos/.test(sql)) return [[{ empresa_id: 7, indicacao_id: indicacaoId }]];
    if (/^UPDATE indicacoes SET status = 'comprou'/.test(sql)) return [{ affectedRows: claim }];
    if (/SELECT id, indicador_lead_id FROM indicacoes/.test(sql)) return [[{ id: 31, indicador_lead_id: 10 }]];
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ indicacoes: cfg }) }]];
    if (/SELECT COUNT\(\*\) AS n FROM indicacoes/.test(sql)) return [[{ n: mes }]];
    if (/^INSERT INTO cupons/.test(sql)) { if (dupRestante-- > 0) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; } return [{ insertId: 88 }]; }
    if (/SELECT telefone FROM leads/.test(sql)) return [[{ telefone: '93911112222' }]];
    if (/SELECT codigo, valido_ate FROM cupons/.test(sql)) return [[{ codigo: 'INDXXXXXX', valido_ate: new Date('2026-12-01') }]];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
  });
  const svc = carregar('src/services/indicacoes.js', { db, extras: {
    'src/utils/assinatura.js': { temRecurso: async () => true },
    'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async (...a) => { enviados.push(a); } },
  } });
  return { db, svc, enviados };
}

test('aoAprovar: gera 1 cupom unico (max_usos 1) ao indicador, marca recompensada e avisa por WhatsApp; webhook repetido nao gera outro', async () => {
  const a = aprovacao();
  assert.strictEqual(await a.svc.aoAprovar(900), true);
  const c = a.db.calls.find((x) => /^INSERT INTO cupons/.test(x.sql));
  assert.match(c.sql, /NULL, DATE_ADD\(CURDATE\(\), INTERVAL \? DAY\), 1, 1\)/, 'sem plano fixo, 1 uso, ativo');
  assert.deepStrictEqual([c.params[0], c.params[2], c.params[3], c.params[4]], [7, 'percentual', 10, 30]);
  assert.match(c.params[1], /^IND[A-Z0-9]{6}$/);
  const up = a.db.calls.find((x) => /SET status = 'recompensada'/.test(x.sql));
  assert.deepStrictEqual(up.params, [88, 31, 7]);
  assert.strictEqual(a.enviados.length, 1);
  assert.match(a.enviados[0][1], /INDXXXXXX/);
  const rep = aprovacao({ claim: 0 });
  assert.strictEqual(await rep.svc.aoAprovar(900), false);
  assert.ok(!rep.db.calls.some((x) => /^INSERT INTO cupons/.test(x.sql)), 'reserva atomica: so uma vez');
});

test('aoAprovar: teto mensal reconferido (recusa sem recompensa), programa desligado e colisao de codigo (tenta de novo)', async () => {
  const lim = aprovacao({ mes: 5 });
  assert.strictEqual(await lim.svc.aoAprovar(900), false);
  assert.ok(lim.db.calls.some((x) => /SET status = 'recusada'/.test(x.sql) && x.params[0] === 'limite_mensal'));
  assert.ok(!lim.db.calls.some((x) => /^INSERT INTO cupons/.test(x.sql)));
  const off = aprovacao({ cfg: { ativo: false } });
  assert.strictEqual(await off.svc.aoAprovar(900), false);
  assert.ok(off.db.calls.some((x) => x.params[0] === 'programa_desligado'));
  const col = aprovacao({ dup: 2 });
  assert.strictEqual(await col.svc.aoAprovar(900), true);
  assert.strictEqual(col.db.calls.filter((x) => /^INSERT INTO cupons/.test(x.sql)).length, 3);
  const sem = aprovacao({ indicacaoId: null });
  assert.strictEqual(await sem.svc.aoAprovar(900), false);
});

test('registrarUsoCupom aciona a recompensa quando o pagamento tem indicacao_id (e nao quebra sem a coluna)', async () => {
  limpar();
  const chamados = [];
  const db = criarDb(async (sql) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT empresa_id, cupom_id, indicacao_id FROM pagamentos/.test(sql)) return [[{ empresa_id: 7, cupom_id: null, indicacao_id: 31 }]];
  });
  const cupons = carregar('src/utils/cupons.js', { db, extras: { 'src/services/indicacoes.js': { aoAprovar: async (id) => { chamados.push(id); } } } });
  assert.strictEqual(await cupons.registrarUsoCupom(900), false, 'sem cupom_id nao conta uso de cupom');
  assert.deepStrictEqual(chamados, [900]);
});

// ---------- controller ----------
function controller(handler, extras = {}) {
  limpar();
  const db = criarDb(handler);
  const enviados = [];
  const ctrl = carregar('src/controllers/indicacoesController.js', { db, extras: {
    'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async (...a) => { enviados.push(a); }, ...extras },
    'src/utils/linkPlanos.js': { linkPlanosDoCliente: async () => 'https://portal.x.com/planos-cliente?empresa_id=7&mikrotik_id=3' },
  } });
  return { db, ctrl, enviados };
}
const req = (o) => criarReq({ empresa_id: 7, user: { id: 2 }, ...o });
const cfgHandler = (cfg) => (sql) => (/SELECT config_json FROM empresa_configs/.test(sql) ? [[{ config_json: JSON.stringify({ indicacoes: cfg }) }]] : undefined);

test('controller: convite exige programa ligado e cliente da empresa; link nao leva cliente_id; envio respeita nao perturbe', async () => {
  const off = controller(cfgHandler({ ativo: false }));
  let res = criarRes();
  await off.ctrl.convite(req({ body: { lead_id: 5 } }), res);
  assert.strictEqual(res.statusCode, 409);
  const c = controller(async (sql, params) => {
    if (/SELECT config_json FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ indicacoes: { ativo: true } }) }]];
    if (/FROM leads WHERE id = \? AND empresa_id/.test(sql)) return [params[1] === 7 && params[0] === 5 ? [{ id: 5, nome: 'Maria Silva', telefone: '93988887777' }] : []];
    if (/FROM indicacoes_codigos WHERE empresa_id = \? AND lead_id/.test(sql)) return [[{ id: 1, codigo: 'INDABC234' }]];
    if (/SELECT nome FROM empresas/.test(sql)) return [[{ nome: 'Apex' }]];
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
  });
  res = criarRes();
  await c.ctrl.convite(req({ body: { lead_id: 99 } }), res);
  assert.strictEqual(res.statusCode, 404);
  res = criarRes();
  await c.ctrl.convite(req({ body: { lead_id: 5 } }), res);
  assert.strictEqual(res.body.codigo, 'INDABC234');
  assert.strictEqual(res.body.link, 'https://portal.x.com/planos-cliente?empresa_id=7&mikrotik_id=3&cupom=INDABC234');
  assert.ok(!/cliente_id/.test(res.body.link), 'o link nunca leva o cliente_id do indicador');
  assert.match(res.body.mensagem, /Olá, Maria!/);
  assert.strictEqual(c.enviados.length, 0, 'sem enviar:true nada sai');
  res = criarRes();
  await c.ctrl.convite(req({ body: { lead_id: 5, enviar: true } }), res);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(c.enviados.length, 1);
  assert.strictEqual(c.enviados[0][2], 7);
});

test('controller: listar mascara o CPF do indicado e escopa por empresa; revogar so recompensa nao usada da empresa; sem tabela = pronto:false', async () => {
  const c = controller(async (sql) => {
    if (/FROM indicacoes i LEFT JOIN leads/.test(sql)) return [[{ id: 1, status: 'recompensada', indicado_cpf: '52998224725', indicador_nome: 'Maria', criado_em: new Date() }]];
    if (/GROUP BY status/.test(sql)) return [[{ status: 'recompensada', n: 2 }]];
    if (/GROUP BY i.indicador_lead_id/.test(sql)) return [[{ nome: 'Maria', indicacoes: 2 }]];
    if (/SELECT id, status, cupom_indicador_id FROM indicacoes/.test(sql)) return [[{ id: 1, status: 'recompensada', cupom_indicador_id: 88 }]];
    if (/^UPDATE cupons SET ativo = 0/.test(sql)) return [{ affectedRows: 0 }];
  });
  let res = criarRes();
  await c.ctrl.listar(req({ query: { status: 'recompensada' } }), res);
  assert.strictEqual(res.body.itens[0].indicado_cpf, '529.***.***-25');
  assert.ok(!JSON.stringify(res.body).includes('52998224725'));
  assert.deepStrictEqual(res.body.resumo, { recompensada: 2 });
  const q = c.db.calls.find((x) => /FROM indicacoes i LEFT JOIN leads/.test(x.sql));
  assert.match(q.sql, /i\.empresa_id = \?/);
  assert.deepStrictEqual(q.params, [7, 'recompensada']);
  res = criarRes();
  await c.ctrl.revogar(req({ params: { id: '1' } }), res);
  assert.strictEqual(res.statusCode, 409);
  const up = c.db.calls.find((x) => /^UPDATE cupons SET ativo = 0/.test(x.sql));
  assert.match(up.sql, /usos = 0/);
  assert.deepStrictEqual(up.params, [88, 7]);
  const sem = controller(async () => { const e = new Error('x'); e.code = 'ER_NO_SUCH_TABLE'; throw e; });
  res = criarRes();
  await sem.ctrl.listar(req({ query: {} }), res);
  assert.strictEqual(res.body.pronto, false);
});

// ---------- PIX com codigo de indicacao: o valor cobrado vem SO do servidor ----------
const silencia = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = l; console.warn = w; console.error = e; }; };
function pix({ mes = 0, comprou = false } = {}) {
  limpar();
  const posts = [];
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: {
    get: async () => ({ data: [] }),
    post: async (url, body) => { posts.push({ url, body }); return { data: { id: 777, point_of_interaction: { transaction_data: { qr_code_base64: 'x', qr_code: 'y' } } } }; },
  } };
  const db = criarDb(async (sql, params) => {
    if (/INFORMATION_SCHEMA/.test(sql)) return [[{ n: 1 }]];
    if (/FROM planos WHERE id/.test(sql)) return [[{ id: 9, empresa_id: 7, nome: 'Plano 1h', valor: 1000, duracao_minutos: 60, mikrotik_id: 3 }]];
    if (/config_type = 'mercadopago'/.test(sql)) return [[{ config_json: { access_token: 'APP_USR-x', public_key: 'APP_USR-p' } }]];
    if (/config_type = 'whatsapp'/.test(sql)) return [[{ config_json: JSON.stringify({ indicacoes: { ativo: true, desconto_indicado: { tipo: 'percentual', valor: 20 } } }) }]];
    if (/FROM cupons/.test(sql)) return [[]]; // nao e cupom comum
    if (/FROM indicacoes_codigos WHERE empresa_id = \? AND codigo/.test(sql)) return [[{ id: 1, lead_id: 10 }]];
    if (/FROM leads WHERE id = \? AND empresa_id/.test(sql)) return [[params[0] === 10 ? { id: 10, cpf: '11144477735', telefone: '93911112222', mac: 'AA:BB:CC:DD:EE:01' } : { telefone: '93933334444', mac: 'AA:BB:CC:DD:EE:02', cpf: '52998224725' }]];
    if (/FROM pagamentos WHERE empresa_id = \? AND status IN/.test(sql)) return [params[1] === '52998224725' ? (comprou ? [{ id: 1 }] : []) : [{ id: 2 }]];
    if (/FROM indicacoes WHERE empresa_id = \? AND indicado_cpf/.test(sql)) return [[]];
    if (/SELECT COUNT\(\*\) AS n FROM indicacoes/.test(sql)) return [[{ n: mes }]];
    if (/INSERT INTO pagamentos/.test(sql)) return [{ insertId: 50 }];
    if (/SELECT empresa_id FROM pagamentos/.test(sql)) return [[{ empresa_id: 7 }]];
    if (/SELECT id FROM indicacoes WHERE pagamento_id/.test(sql)) return [[{ id: 31 }]];
    if (/SELECT attribute, value FROM radcheck/.test(sql)) return [[]];
  });
  return { db, mod: carregar('src/controllers/pagamentoController.js', { db }), posts };
}
const reqPix = (extra = {}) => criarReq({ body: { plano_id: 9, mac: 'aa:bb:cc:dd:ee:02', ip: '10.0.0.5', cpf: '529.982.247-25', cliente_id: 55, ...extra } });

test('PIX com codigo de indicacao: cobra com o desconto da config (valor do cliente ignorado) e grava a indicacao pendente', async () => {
  const { db, mod, posts } = pix();
  const res = criarRes(); const un = silencia();
  try { await mod.gerarPagamento(reqPix({ cupom: 'indabc234', valor: 1, desconto: 9999, valor_final: 1 }), res); } finally { un(); }
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(posts[0].body.transaction_amount, 8, '1000 - 20% = 800 centavos');
  const ins = db.calls.find((c) => /INSERT INTO pagamentos/.test(c.sql));
  assert.ok(ins.params.includes(800) && !ins.params.includes(1));
  assert.ok(db.calls.some((c) => /^INSERT IGNORE INTO indicacoes/.test(c.sql)));
  const up = db.calls.find((c) => /^UPDATE pagamentos SET indicacao_id/.test(c.sql));
  assert.deepStrictEqual(up.params, [31, 1000, 50, 7]);
  assert.ok(!db.calls.some((c) => /SET cupom_id/.test(c.sql)), 'indicacao nao usa cupom_id');
});

test('PIX com codigo de indicacao recusado (nao e a 1a compra, teto mensal) => 400 generico, nada gravado nem cobrado', async () => {
  for (const cfg of [{ comprou: true }, { mes: 5 }]) {
    const { db, mod, posts } = pix(cfg);
    const res = criarRes(); const un = silencia();
    try { await mod.gerarPagamento(reqPix({ cupom: 'INDABC234' }), res); } finally { un(); }
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, 'Cupom inválido ou indisponível.');
    assert.ok(!db.calls.some((c) => /INSERT INTO pagamentos/.test(c.sql)));
    assert.strictEqual(posts.length, 0);
  }
});
