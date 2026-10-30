// Destaque do ganho de cada plano maior na landing (frontend/src/utils/ganhosPlano.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const carregar = () => import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/utils/ganhosPlano.js')).href);

const base = { max_equipamentos: 2, max_admins: 1, gratis: 0 };

test('ganhosDoPlano: diferencas de limites e recursos novos contra o plano anterior', async () => {
  const { ganhosDoPlano } = await carregar();
  const g = ganhosDoPlano({ ...base, max_equipamentos: 5, max_admins: 2, inclui_whatsapp: 1, inclui_dominio: 1 }, { ...base, inclui_whatsapp: 1 });
  assert.strictEqual(g.equipamentos, 3);
  assert.strictEqual(g.admins, 1);
  assert.deepStrictEqual(g.novos, ['dominio']);
});

test('ganhosDoPlano: ilimitado, sem ganho e primeiro plano', async () => {
  const { ganhosDoPlano } = await carregar();
  assert.strictEqual(ganhosDoPlano(base, null), null);
  assert.strictEqual(ganhosDoPlano({ ...base, max_equipamentos: null }, base).equipamentos, 'ilimitados');
  const igual = ganhosDoPlano(base, base);
  assert.deepStrictEqual([igual.equipamentos, igual.admins, igual.novos], [null, null, []]);
  // anterior ilimitado e este limitado nao e ganho
  assert.strictEqual(ganhosDoPlano(base, { ...base, max_equipamentos: null }).equipamentos, null);
});
