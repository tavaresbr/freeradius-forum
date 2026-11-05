// Balao de suporte: validacao da config e endpoint publico (so dados de exibicao).
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { criarDb, carregar, criarReq, criarRes } = require('../helpers/mocks');
const u = require('../../src/utils/suporte');

test('telefone e validarConfig', () => {
  assert.strictEqual(u.telefoneSuporte('(11) 99999-0000'), '5511999990000');
  assert.strictEqual(u.telefoneSuporte('123'), null);
  assert.strictEqual(u.numeroDoJid('5511999990000@s.whatsapp.net'), '5511999990000');
  assert.ok(u.validarConfig({ telefone: 'abc' }).erro);
  assert.ok(u.validarConfig({ mensagem: 'x'.repeat(301) }).erro);
  const ok = u.validarConfig({ ativo: false, telefone: '', mensagem: ' oi ' });
  assert.deepStrictEqual(ok.config, { ativo: false, telefone: '', mensagem: 'oi' });
  assert.strictEqual(u.validarConfig({}).config.mensagem, u.MSG_PADRAO);
});

test('publico: usa o telefone da config; sem ele, o numero conectado; desligado ou sem numero = inativo', async () => {
  const mk = (cfg, instancias) => {
    const db = criarDb(async (sql) => {
      if (/plataforma_configs/.test(sql)) return [cfg ? [{ config_json: JSON.stringify(cfg) }] : []];
      if (/FROM empresa_configs/.test(sql)) return [[{ config_json: JSON.stringify({ api_url: 'http://evo', api_key: 'k', instance_name: 'empresa_1' }) }]];
    });
    const orig = axios.get;
    axios.get = async () => ({ data: instancias });
    return { c: carregar('src/controllers/suporteController.js', { db }), volta: () => { axios.get = orig; } };
  };
  let t = mk({ ativo: true, telefone: '11988887777', mensagem: 'Oi' }, []);
  let res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.deepStrictEqual(res.body, { ativo: true, whatsapp: '5511988887777', mensagem: 'Oi' });
  t = mk(null, [{ name: 'empresa_1', ownerJid: '5511977776666@s.whatsapp.net' }]);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.whatsapp, '5511977776666'); assert.strictEqual(res.body.ativo, true);
  t = mk({ ativo: false, telefone: '11988887777' }, []);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.ativo, false); assert.strictEqual(res.body.whatsapp, null);
  t = mk(null, []);
  res = criarRes(); await t.c.publico(criarReq(), res); t.volta();
  assert.strictEqual(res.body.ativo, false);
});
