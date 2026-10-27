const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const PLANOS = [
  { id: 1, nome: 'Grátis', valor: 0 }, { id: 2, nome: 'Start', valor: 59.9 }, { id: 3, nome: 'Pro', valor: 129.9 },
  { id: 4, nome: 'Business', valor: 249.9 }, { id: 5, nome: 'Business Plus', valor: 399.9 }, { id: 6, nome: 'Enterprise', valor: 499.9 },
];
let avisoUpgrade;
test.before(async () => {
  ({ avisoUpgrade } = await import(path.join(__dirname, '../../../frontend/src/utils/upgradeAviso.js')));
});

test('sem gasto extra ou plano desconhecido: sem aviso', () => {
  assert.strictEqual(avisoUpgrade({ planos: PLANOS, planoAtualId: 2 }), null);
  assert.strictEqual(avisoUpgrade({ planos: PLANOS, planoAtualId: 99, extra: 50 }), null);
});

test('gasto pequeno perto do plano atual: sem aviso', () => {
  assert.strictEqual(avisoUpgrade({ planos: PLANOS, planoAtualId: 2, extra: 29.9 }), null); // 89,80 < metade do degrau ate o Pro
});

test('Start + WhatsApp + Campanhas (R$ 149,70) ja passa o Pro (R$ 129,90): economiza', () => {
  const a = avisoUpgrade({ planos: PLANOS, planoAtualId: 2, extra: 89.8 });
  assert.strictEqual(a.tipo, 'economiza');
  assert.strictEqual(a.plano.nome, 'Pro');
  assert.strictEqual(a.diferenca, 19.8); // 149,70 - 129,90
});

test('quase la: avisa quanto falta para o proximo plano', () => {
  const a = avisoUpgrade({ planos: PLANOS, planoAtualId: 2, adicionaisValor: 29.9, extra: 29.9 }); // 119,70 < 129,90
  assert.strictEqual(a.tipo, 'quase');
  assert.strictEqual(a.plano.nome, 'Pro');
  assert.strictEqual(a.diferenca, 10.2);
});

test('escolhe o plano MAIS completo que ainda custa menos que a soma', () => {
  const a = avisoUpgrade({ planos: PLANOS, planoAtualId: 3, extra: 150 }); // 279,90: Business (249,90) compensa
  assert.strictEqual(a.plano.nome, 'Business');
  assert.strictEqual(a.tipo, 'economiza');
});

test('maior plano: nada acima para sugerir', () => {
  assert.strictEqual(avisoUpgrade({ planos: PLANOS, planoAtualId: 6, extra: 100 }), null);
});
