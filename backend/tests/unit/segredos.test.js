const test = require('node:test');
const assert = require('node:assert');
const { mascarar, mascararObjeto, preservarSegredos } = require('../../src/utils/segredos');
const { criarDb, criarRes, carregar } = require('../helpers/mocks');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';

test('mascarar nunca devolve o valor inteiro', () => {
  assert.strictEqual(mascarar('APP_USR-1234567890'), 'APP_...');
  assert.strictEqual(mascarar('curto'), '...');
  assert.strictEqual(mascarar(''), '');
});

test('mascararObjeto mascara so os campos secretos e marca _definido', () => {
  const r = mascararObjeto({ access_token: 'APP_USR-123456789', public_key: 'pk', senha: 'x' });
  assert.strictEqual(r.access_token, 'APP_...');
  assert.strictEqual(r.access_token_definido, true);
  assert.strictEqual(r.public_key, 'pk');
  assert.strictEqual(r.senha, '...');
});

test('preservarSegredos mantem o gravado quando vem vazio/mascarado e troca quando vem novo', () => {
  const atual = { access_token: 'segredo-antigo-123', client_secret: 'cs-antigo' };
  const r = preservarSegredos({ access_token: 'APP_...', client_secret: 'novo-cs', access_token_definido: true }, atual);
  assert.strictEqual(r.access_token, 'segredo-antigo-123');
  assert.strictEqual(r.client_secret, 'novo-cs');
  assert.strictEqual('access_token_definido' in r, false);
  assert.strictEqual(preservarSegredos({ access_token: '' }, atual).access_token, 'segredo-antigo-123');
});

test('whatsapp getConfig nao devolve a chave global do .env', async () => {
  process.env.EVOLUTION_API_KEY = 'CHAVE-GLOBAL-SECRETA';
  const db = criarDb(() => [[]]);
  const ctrl = carregar('src/controllers/whatsappController.js', { db });
  const res = criarRes();
  await ctrl.getConfig({ empresa_id: 7, user: { role: 'owner' } }, res);
  assert.doesNotMatch(JSON.stringify(res.body), /CHAVE-GLOBAL/);
  assert.strictEqual(res.body.api_key, '');
  assert.strictEqual(res.body.instance_name, 'empresa_7');
});

test('whatsapp saveConfig de empresa ignora api_url/api_key/instance_name de terceiros', async () => {
  const db = criarDb(() => [[]]);
  const ctrl = carregar('src/controllers/whatsappController.js', { db });
  const res = criarRes();
  await ctrl.saveConfig({
    empresa_id: 7, user: { role: 'owner' },
    body: { api_url: 'http://atacante.com', api_key: 'x', instance_name: 'empresa_8' },
  }, res);
  const ins = db.calls.find((c) => /INSERT INTO empresa_configs/.test(c.sql));
  const cfg = JSON.parse(ins.params[1]);
  assert.strictEqual(cfg.instance_name, 'empresa_7');
  assert.doesNotMatch(cfg.api_url, /atacante/);
  assert.strictEqual(cfg.api_key, '');
});

test('token de download nao serve como sessao e so abre o modulo para o qual foi emitido', () => {
  const auth = require('../../src/middleware/auth');
  const { issueDownloadToken, verifyDownloadToken } = require('../../src/middleware/downloadToken');

  const res = criarRes();
  issueDownloadToken({ query: { para: 'leads' }, user: { id: 1, role: 'owner' }, empresa_id: 3 }, res);
  const dl = res.body.token;

  const r1 = criarRes(); let passou = false;
  auth({ headers: { authorization: `Bearer ${dl}` } }, r1, () => { passou = true; });
  assert.strictEqual(passou, false);
  assert.strictEqual(r1.statusCode, 403);

  passou = false;
  verifyDownloadToken('leads')({ query: { token: dl } }, criarRes(), () => { passou = true; });
  assert.strictEqual(passou, true);
  const r2 = criarRes(); passou = false;
  verifyDownloadToken('portais')({ query: { token: dl } }, r2, () => { passou = true; });
  assert.strictEqual(passou, false);

  const r3 = criarRes();
  issueDownloadToken({ query: {}, user: { id: 1 }, empresa_id: 3 }, r3);
  assert.strictEqual(r3.statusCode, 400);
});
