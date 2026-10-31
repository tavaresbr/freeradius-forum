const test = require('node:test');
const assert = require('node:assert');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');
const u = require('../../src/utils/boasVindas');

test('config: padrao, mescla e validacao', () => {
  const c = u.mesclarConfig(null);
  assert.equal(c.ativo, true);
  assert.equal(c.lembrete_ativacao.ativo, false);
  assert.ok(c.mensagem.includes('{{nome}}'));
  assert.equal(u.mesclarConfig({ ativo: false, mensagem: 'curta' }).mensagem, c.mensagem); // invalida cai no padrao
  assert.equal(u.mesclarConfig({ ativo: false }).ativo, false);
  assert.ok(u.validarConfig({ ativo: true, mensagem: 'x', lembrete_ativacao: { mensagem: 'y'.repeat(20) } }).erro);
  assert.ok(u.validarConfig({ ativo: true, mensagem: 'y'.repeat(20), lembrete_ativacao: { mensagem: 'z'.repeat(1001) } }).erro);
  const ok = u.validarConfig({ ativo: 1, mensagem: ' ' + 'a'.repeat(20) + ' ', lembrete_ativacao: { ativo: true, mensagem: 'b'.repeat(20) } });
  assert.equal(ok.config.ativo, false); // so true literal liga
  assert.equal(ok.config.lembrete_ativacao.ativo, true);
  assert.equal(ok.config.mensagem, 'a'.repeat(20));
});

test('texto manual e variaveis', () => {
  assert.ok(u.validarTextoManual('  ').erro);
  assert.ok(u.validarTextoManual('x'.repeat(1001)).erro);
  assert.equal(u.validarTextoManual(' oi ').texto, 'oi');
  const v = u.montarVars({ empresa: { nome: 'Francisco Robson Vieira' }, plano: 'Popular', trialAte: new Date('2026-11-06T15:00:00Z'), linkPainel: 'https://x/login/a' });
  assert.equal(v.nome, 'Francisco');
  assert.equal(v.trial_ate, '06/11/2026');
  assert.equal(u.linkPainelDaEmpresa('minha', 'https://painel.exemplo.com/'), 'https://painel.exemplo.com/login/minha');
  assert.equal(u.linkPainelDaEmpresa('minha', ''), '');
});

function criarServico({ telefone = '(85) 99138-0459', conectada = true, jaEnviada = false, enviar, temColuna = true, empresaId = 21, conversaExistente = false } = {}) {
  const enviadas = [];
  const db = criarDb((sql) => {
    if (/FROM plataforma_configs/i.test(sql)) return [[]];
    if (/SELECT id, nome, slug, telefone, criado_em FROM empresas/i.test(sql)) return [[{ id: empresaId, nome: 'Francisco Robson', slug: 'fr', telefone, criado_em: new Date() }]];
    if (/FROM assinaturas a LEFT JOIN saas_planos/i.test(sql)) return [[{ plano: 'Popular', trial_ate: new Date('2026-11-06T15:00:00Z'), vence_em: null }]];
    if (/SELECT \* FROM whatsapp_conversas WHERE empresa_id = \? AND telefone IS NOT NULL/i.test(sql)) return [conversaExistente ? [{ id: 9, empresa_id: 1, telefone: '5585991380459', jid: 'x@s.whatsapp.net' }] : []];
    if (/INSERT INTO whatsapp_conversas/i.test(sql)) return [{ insertId: 11 }];
    if (/SELECT \* FROM whatsapp_conversas WHERE id = \?/i.test(sql)) return [[{ id: 11, empresa_id: 1, telefone: '5585991380459', jid: 'x@s.whatsapp.net' }]];
    if (/SELECT slug FROM empresas WHERE id/i.test(sql)) return [[{ slug: 'plataforma' }]];
    if (/UPDATE empresas SET boas_vindas_em = NOW\(\) WHERE id = \? AND boas_vindas_em IS NULL/i.test(sql)) return [{ affectedRows: jaEnviada ? 0 : 1 }];
    if (/UPDATE empresas SET boas_vindas_em/i.test(sql)) return [{ affectedRows: 1 }];
  });
  const svc = carregar('src/services/boasVindasEmpresa.js', {
    db,
    extras: {
      'src/controllers/whatsappController.js': {
        instanciaConectada: async () => conectada,
        formatarNumeroComNonoDigito: (n) => String(n),
        enviarMensagemEstrita: async () => {},
      },
      'src/services/whatsappAtendimento.js': {
        enviarTexto: async (emp, adminId, conversa, texto, opcoes) => { if (enviar) await enviar(); enviadas.push({ emp, adminId, conversa, texto, opcoes }); return { id: 1 }; },
      },
      'src/utils/schemaCache.js': { temColuna: async () => temColuna, limparCache() {} },
    },
  });
  return { svc, db, enviadas };
}

test('boas-vindas: envia uma vez, renderiza variaveis e registra historico', async () => {
  const { svc, db, enviadas } = criarServico();
  const r = await svc.enviarBoasVindas(21);
  assert.equal(r.ok, true);
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].emp, 1); // sai pelo chat da empresa da plataforma
  assert.equal(enviadas[0].conversa.id, 11); // conversa criada na caixa da plataforma
  assert.equal(enviadas[0].opcoes.automatica, true);
  assert.ok(db.calls.some((c) => /INSERT INTO whatsapp_conversas/i.test(c.sql)));
  assert.ok(enviadas[0].texto.includes('Francisco'));
  assert.ok(enviadas[0].texto.includes('Popular'));
  assert.ok(!enviadas[0].texto.includes('{{'));
  assert.ok(db.calls.some((c) => /INSERT INTO empresa_historico/i.test(c.sql) && c.params.includes('boas_vindas')));
});

test('boas-vindas: nao reenvia, ignora telefone invalido, plataforma e instancia desligada', async () => {
  let t = criarServico({ jaEnviada: true });
  assert.equal((await t.svc.enviarBoasVindas(21)).motivo, 'ja_enviada');
  assert.equal(t.enviadas.length, 0);
  t = criarServico({ telefone: '123' });
  assert.equal((await t.svc.enviarBoasVindas(21)).motivo, 'telefone_invalido');
  t = criarServico({ conectada: false });
  assert.equal((await t.svc.enviarBoasVindas(21)).motivo, 'whatsapp_desconectado');
  assert.ok(!t.db.calls.some((c) => /UPDATE empresas SET boas_vindas_em/i.test(c.sql))); // nada reservado
  t = criarServico({ temColuna: false });
  assert.equal((await t.svc.enviarBoasVindas(21)).motivo, 'sem_migration');
  t = criarServico();
  assert.equal((await t.svc.enviarBoasVindas(1)).motivo, 'empresa_da_plataforma');
});

test('boas-vindas: falha no envio devolve a reserva', async () => {
  const { svc, db, enviadas } = criarServico({ enviar: async () => { throw new Error('evolution fora'); } });
  const r = await svc.enviarBoasVindas(21);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'erro_envio');
  assert.equal(enviadas.length, 0);
  assert.ok(db.calls.some((c) => /SET boas_vindas_em = NULL/i.test(c.sql)));
});

test('envio manual: valida telefone/instancia e grava historico sem o numero completo', async () => {
  let t = criarServico({ telefone: '' });
  await assert.rejects(() => t.svc.enviarManual(21, 'oi', 7), (e) => e.status === 400);
  t = criarServico({ conectada: false });
  await assert.rejects(() => t.svc.enviarManual(21, 'oi', 7), (e) => e.status === 409);
  t = criarServico({ conversaExistente: true });
  const man = await t.svc.enviarManual(21, 'Oi {{nome}}, seu plano {{plano}}', 7);
  assert.equal(man.conversa_id, 9); // reaproveita a conversa que ja existe
  assert.equal(t.enviadas[0].texto, 'Oi Francisco, seu plano Popular');
  assert.equal(t.enviadas[0].adminId, 7);
  assert.equal(t.enviadas[0].opcoes.automatica, false);
  assert.ok(!t.db.calls.some((c) => /INSERT INTO whatsapp_conversas/i.test(c.sql)));
  const h = t.db.calls.find((c) => /INSERT INTO empresa_historico/i.test(c.sql));
  assert.ok(h.params.includes('whatsapp_enviado'));
  assert.ok(!h.params.join(' ').includes('5585991380459'));
  assert.equal((await t.svc.abrirConversaDaEmpresa(21)).plataformaSlug, 'plataforma');
  t = criarServico({ enviar: async () => { throw new Error('x'); } });
  await assert.rejects(() => t.svc.enviarManual(21, 'oi', 7), (e) => e.status === 502);
});

test('config: PUT valida e salva; teste exige telefone valido', async () => {
  const db = criarDb();
  delete require.cache[require.resolve('../../src/services/boasVindasEmpresa.js')]; // recarrega com o db deste teste
  const c = carregar('src/controllers/boasVindasController.js', {
    db,
    extras: {
      'src/controllers/whatsappController.js': { instanciaConectada: async () => true, enviarMensagemEstrita: async () => {} },
    },
  });
  let res = criarRes();
  await c.salvar(criarReq({ body: { ativo: true, mensagem: 'curta' } }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.salvar(criarReq({ body: { ativo: true, mensagem: 'a'.repeat(30), lembrete_ativacao: { ativo: false, mensagem: 'b'.repeat(30) } } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(db.calls.some((x) => /INSERT INTO plataforma_configs/i.test(x.sql)));
  res = criarRes();
  await c.teste(criarReq({ body: { telefone: '12' } }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.teste(criarReq({ body: { telefone: '(85) 99138-0459' } }), res);
  assert.equal(res.statusCode, 200);
});
