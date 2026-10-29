const test = require('node:test');
const assert = require('node:assert');
const { montarAlertas, diasSemConexaoValido } = require('../../src/utils/alertasPlataforma');

const AGORA = new Date('2026-10-29T12:00:00Z');
const dias = (n) => new Date(AGORA.getTime() - n * 86400000);
const base = { offline: new Map(), ultimaConexao: new Map(), whatsapp: new Map(), dias: 3, agora: AGORA };
const emp = (o = {}) => ({ id: 1, ativo: 1, criado_em: dias(30), total_mikrotiks: 1, ...o });

test('equipamento offline: critico quando todos, aviso quando parte; estado velho e ignorado', () => {
  const v = (m) => montarAlertas({ ...base, empresas: [emp()], ultimaConexao: new Map([[1, dias(0)]]),
    offline: new Map([[1, { offline: m.off, total: m.tot, verificado_em: m.em }]]) });
  assert.equal(v({ off: 2, tot: 2, em: new Date(AGORA - 60000) })[0].alertas[0].nivel, 'critico');
  assert.equal(v({ off: 1, tot: 2, em: new Date(AGORA - 60000) })[0].alertas[0].nivel, 'aviso');
  assert.deepEqual(v({ off: 1, tot: 2, em: new Date(AGORA - 3 * 3600000) }), []);
});

test('sem conexao: usa o limite de dias e a idade da empresa', () => {
  const r = montarAlertas({ ...base, empresas: [emp()], ultimaConexao: new Map([[1, dias(5)]]) });
  assert.equal(r[0].alertas[0].mensagem, 'Sem conexões há 5 dias');
  assert.deepEqual(montarAlertas({ ...base, empresas: [emp()], ultimaConexao: new Map([[1, dias(1)]]) }), []);
  // nunca conectou: alerta so se a empresa ja tem mais dias que o limite
  assert.equal(montarAlertas({ ...base, empresas: [emp()] })[0].alertas[0].mensagem, 'Nenhuma conexão registrada');
  assert.deepEqual(montarAlertas({ ...base, empresas: [emp({ criado_em: dias(1) })] }), []);
  // sem equipamento nao ha o que conectar
  assert.deepEqual(montarAlertas({ ...base, empresas: [emp({ total_mikrotiks: 0 })] }), []);
});

test('whatsapp desconectado so alerta com false (undefined = nao configurado)', () => {
  const ok = { ...base, empresas: [emp({ total_mikrotiks: 0 })] };
  assert.equal(montarAlertas({ ...ok, whatsapp: new Map([[1, false]]) })[0].alertas[0].tipo, 'whatsapp_desconectado');
  assert.deepEqual(montarAlertas({ ...ok, whatsapp: new Map([[1, true]]) }), []);
  assert.deepEqual(montarAlertas(ok), []);
});

test('empresa inativa nao gera alerta; dias invalido volta ao padrao', () => {
  assert.deepEqual(montarAlertas({ ...base, empresas: [emp({ ativo: 0 })], whatsapp: new Map([[1, false]]) }), []);
  assert.equal(diasSemConexaoValido('abc'), 3);
  assert.equal(diasSemConexaoValido('0'), 3);
  assert.equal(diasSemConexaoValido('7'), 7);
});
