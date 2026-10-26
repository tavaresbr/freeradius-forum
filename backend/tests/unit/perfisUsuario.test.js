const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ---- banco em memoria que entende so as queries de perfis/admins ----
let S;
const reset = () => {
  S = { grupos: [], perms: [], ag: [], admins: [], ae: [], seq: { g: 0, a: 0, p: 0 } };
};
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
const fakeDb = {
  async execute(sqlRaw, p = []) {
    const sql = norm(sqlRaw);
    let m;
    if (/^SELECT id FROM grupos_permissao WHERE nome = \?/.test(sql)) return [[S.grupos.find((g) => g.nome === p[0])]];
    if (/^INSERT INTO grupos_permissao/.test(sql)) { const id = ++S.seq.g; S.grupos.push({ id, nome: p[0] }); return [{ insertId: id }]; }
    if (/^SELECT id FROM grupo_permissoes WHERE grupo_id = \? AND modulo = \?/.test(sql)) return [[S.perms.find((x) => x.grupo_id === p[0] && x.modulo === p[1])]];
    if (/^INSERT INTO grupo_permissoes/.test(sql)) { S.perms.push({ id: ++S.seq.p, grupo_id: p[0], modulo: p[1], ver: p[2], criar: p[3], editar: p[4], excluir: p[5] }); return [{ affectedRows: 1 }]; }
    if (/^DELETE FROM admin_grupos WHERE admin_id = \? AND grupo_id = \?/.test(sql)) { S.ag = S.ag.filter((x) => !(x.admin_id === p[0] && x.grupo_id === p[1])); return [{ affectedRows: 1 }]; }
    if (/^INSERT IGNORE INTO admin_grupos/.test(sql)) { if (!S.ag.some((x) => x.admin_id === p[0] && x.grupo_id === p[1])) S.ag.push({ admin_id: p[0], grupo_id: p[1] }); return [{ affectedRows: 1 }]; }
    if (/^SELECT COUNT\(\*\) AS total FROM admins WHERE empresa_id = \? AND role <> 'super_admin'/.test(sql)) return [[{ total: S.admins.filter((a) => a.empresa_id === p[0] && a.role !== 'super_admin').length }]];
    if (/^INSERT INTO admins/.test(sql)) { const id = ++S.seq.a; S.admins.push({ id, empresa_id: p[0], email: p[1], password: p[2], nome: p[3], role: p[4] }); return [{ insertId: id }]; }
    if (/^INSERT INTO admin_empresas/.test(sql)) { S.ae.push({ admin_id: p[0], empresa_id: p[1], role: p[2] !== undefined ? p[2] : (sql.includes("'owner'") ? 'owner' : undefined) }); return [{ affectedRows: 1 }]; }
    if (/^SELECT id, email, nome, role, empresa_id FROM admins WHERE id = \?/.test(sql)) return [[S.admins.find((a) => a.id === Number(p[0]))]];
    if (/^UPDATE admins SET email/.test(sql)) return [{ affectedRows: 1 }];
    if ((m = /^UPDATE admins SET role = \? WHERE id = \?/.exec(sql))) { S.admins.find((a) => a.id === p[1]).role = p[0]; return [{ affectedRows: 1 }]; }
    if (/COUNT\(DISTINCT a\.id\) AS n/.test(sql)) {
      const gid = S.grupos.find((g) => g.nome === p[1]);
      const n = gid ? S.admins.filter((a) => a.empresa_id === p[0] && S.ag.some((x) => x.admin_id === a.id && x.grupo_id === gid.id)).length : 0;
      return [[{ n }]];
    }
    if (/^SELECT g\.nome FROM admin_grupos ag JOIN grupos_permissao g/.test(sql)) {
      const rows = S.ag.filter((x) => x.admin_id === p[0]).map((x) => ({ nome: S.grupos.find((g) => g.id === x.grupo_id).nome })).filter((r) => r.nome === p[1] || r.nome === p[2]);
      return [rows];
    }
    if (/^SELECT id, email, nome, role, empresa_id, created_at FROM admins WHERE empresa_id = \?/.test(sql)) return [S.admins.filter((a) => a.empresa_id === p[0])];
    throw new Error('SQL nao previsto no teste: ' + sql);
  },
  async query(sqlRaw, p = []) {
    const sql = norm(sqlRaw);
    if (/FROM admin_grupos ag JOIN grupos_permissao g ON g\.id = ag\.grupo_id WHERE ag\.admin_id IN \(\?\) AND g\.nome IN \(\?\)/.test(sql)) {
      const [ids, nomes] = p;
      return [S.ag.filter((x) => ids.includes(x.admin_id)).map((x) => ({ admin_id: x.admin_id, nome: S.grupos.find((g) => g.id === x.grupo_id).nome })).filter((r) => nomes.includes(r.nome))];
    }
    return this.execute(sqlRaw, p);
  },
  async getConnection() { return { ...fakeDb, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }; },
};
const stub = (rel, exports) => { const f = require.resolve(path.join(__dirname, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('../../db', fakeDb);
stub('../../src/utils/assinatura', { checarLimiteSeguro: async () => ({ ok: true }), criarTrial: async () => {} });
stub('../../src/utils/empresaSetup', { criarPortaisPadrao: async () => {}, criarPlanosPadrao: async () => {} });

const perfis = require('../../src/utils/perfis');
const ctrl = require('../../src/controllers/adminController');
const registro = require('../../src/controllers/registroController');

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const req = (body, user, extra = {}) => ({ body, user, empresa_id: 5, params: {}, ...extra });
const nomeGrupo = (adminId) => S.ag.filter((x) => x.admin_id === adminId).map((x) => S.grupos.find((g) => g.id === x.grupo_id).nome);

test('garantirPerfil cria o grupo e as permissoes uma vez so; Usuario Padrao = operacional sem excluir', async () => {
  reset();
  const a = await perfis.garantirPerfil(fakeDb, 'padrao');
  const b = await perfis.garantirPerfil(fakeDb, 'padrao');
  assert.strictEqual(a, b);
  assert.strictEqual(S.grupos.length, 1);
  const mod = (m) => S.perms.find((x) => x.grupo_id === a && x.modulo === m);
  assert.deepStrictEqual([mod('clientes').ver, mod('clientes').criar, mod('clientes').editar, mod('clientes').excluir], [1, 1, 1, 0]);
  assert.deepStrictEqual([mod('dashboard').ver, mod('dashboard').criar], [1, 0]);
  for (const negado of ['mikrotiks', 'vpn', 'portais', 'planos', 'compliance', 'configuracoes', 'usuarios']) assert.strictEqual(mod(negado), undefined, negado);
});

test('garantirPerfil nao sobrescreve permissao ja ajustada pelo super admin', async () => {
  reset();
  const id = await perfis.garantirPerfil(fakeDb, 'padrao');
  S.perms.find((x) => x.grupo_id === id && x.modulo === 'clientes').excluir = 1;
  await perfis.garantirPerfil(fakeDb, 'padrao');
  assert.strictEqual(S.perms.find((x) => x.grupo_id === id && x.modulo === 'clientes').excluir, 1);
});

test('Administrador = todos os modulos com acesso total', async () => {
  reset();
  const id = await perfis.garantirPerfil(fakeDb, 'administrador');
  const { MODULOS } = require('../../src/controllers/grupoPermissaoController');
  assert.strictEqual(S.perms.filter((x) => x.grupo_id === id && x.ver && x.criar && x.editar && x.excluir).length, MODULOS.length);
});

test('atribuirPerfil troca entre os 2 perfis do sistema e preserva grupo customizado', async () => {
  reset();
  S.grupos.push({ id: ++S.seq.g, nome: 'Grupo do Super Admin' });
  S.admins.push({ id: ++S.seq.a, empresa_id: 5, role: 'operator' });
  S.ag.push({ admin_id: 1, grupo_id: 1 });
  await perfis.atribuirPerfil(fakeDb, 1, 'administrador');
  assert.deepStrictEqual(nomeGrupo(1).sort(), ['Acesso Completo', 'Grupo do Super Admin']);
  await perfis.atribuirPerfil(fakeDb, 1, 'padrao');
  assert.deepStrictEqual(nomeGrupo(1).sort(), ['Grupo do Super Admin', 'Usuário Padrão']);
});

test('primeiro usuario da empresa e sempre Administrador/owner, mesmo pedindo padrao', async () => {
  reset();
  const r = res();
  await ctrl.criarAdmin(req({ email: 'a@x.com', senha: '123456', perfil: 'padrao' }, { role: 'super_admin' }), r);
  assert.strictEqual(r.code, 201);
  assert.strictEqual(S.admins[0].role, 'owner');
  assert.deepStrictEqual(nomeGrupo(S.admins[0].id), ['Acesso Completo']);
  assert.ok(S.ae.some((v) => v.admin_id === S.admins[0].id && v.empresa_id === 5), 'sem vinculo em admin_empresas');
});

test('demais usuarios respeitam o perfil escolhido (padrao por default) e role acompanha', async () => {
  reset();
  S.admins.push({ id: ++S.seq.a, empresa_id: 5, role: 'owner' });
  const dono = { role: 'owner' };
  let r = res();
  await ctrl.criarAdmin(req({ email: 'b@x.com', senha: '123456' }, dono), r);
  const padrao = S.admins.find((a) => a.email === 'b@x.com');
  assert.strictEqual(r.code, 201);
  assert.deepStrictEqual([padrao.role, nomeGrupo(padrao.id)], ['operator', ['Usuário Padrão']]);
  r = res();
  await ctrl.criarAdmin(req({ email: 'c@x.com', senha: '123456', perfil: 'administrador' }, dono), r);
  const adm = S.admins.find((a) => a.email === 'c@x.com');
  assert.deepStrictEqual([adm.role, nomeGrupo(adm.id)], ['owner', ['Acesso Completo']]);
});

test('manager nao cria Administrador; perfil invalido = 400', async () => {
  reset();
  S.admins.push({ id: ++S.seq.a, empresa_id: 5, role: 'owner' });
  let r = res();
  await ctrl.criarAdmin(req({ email: 'd@x.com', senha: '123456', perfil: 'administrador' }, { role: 'manager' }), r);
  assert.strictEqual(r.code, 403);
  assert.strictEqual(S.admins.length, 1);
  r = res();
  await ctrl.criarAdmin(req({ email: 'd@x.com', senha: '123456', perfil: 'root' }, { role: 'owner' }), r);
  assert.strictEqual(r.code, 400);
});

test('nao rebaixa nem remove o ultimo Administrador; com dois, rebaixa e a role vira operator', async () => {
  reset();
  S.admins.push({ id: ++S.seq.a, empresa_id: 5, role: 'owner', email: 'a@x.com' });
  S.admins.push({ id: ++S.seq.a, empresa_id: 5, role: 'owner', email: 'b@x.com' });
  await perfis.atribuirPerfil(fakeDb, 1, 'administrador');
  const dono = { role: 'owner' };
  let r = res();
  await ctrl.atualizarAdmin(req({ email: 'a@x.com', perfil: 'padrao' }, dono, { params: { id: 1 } }), r);
  assert.strictEqual(r.code, 400);
  assert.deepStrictEqual(nomeGrupo(1), ['Acesso Completo']);
  r = res();
  await ctrl.deletarAdmin({ params: { id: 1 }, user: dono, empresa_id: 5 }, r);
  assert.strictEqual(r.code, 400);

  await perfis.atribuirPerfil(fakeDb, 2, 'administrador');
  r = res();
  await ctrl.atualizarAdmin(req({ email: 'a@x.com', perfil: 'padrao' }, dono, { params: { id: 1 } }), r);
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual([nomeGrupo(1), S.admins[0].role], [['Usuário Padrão'], 'operator']);
});

test('GET /perfis so devolve os 2 perfis do sistema', () => {
  const r = res();
  ctrl.listarPerfis({}, r);
  assert.deepStrictEqual(r.body.map((p) => p.chave), ['administrador', 'padrao']);
  assert.deepStrictEqual(Object.keys(r.body[0]).sort(), ['chave', 'descricao', 'nome']);
});

test('registro publico: dono vira owner vinculado em admin_empresas e Administrador', async () => {
  reset();
  const origExec = fakeDb.execute;
  // registrarEmpresa consulta e insere empresas/admins com SQL proprio
  fakeDb.execute = async function (sqlRaw, p = []) {
    const sql = norm(sqlRaw);
    if (/^SELECT id FROM admins WHERE email = \?/.test(sql)) return [[]];
    if (/^SELECT id FROM empresas WHERE slug = \?/.test(sql)) return [[]];
    if (/^SELECT id FROM empresas WHERE (tipo_pessoa|REPLACE)/.test(sql)) return [[]];
    if (/^INSERT INTO empresas/.test(sql)) return [{ insertId: 9 }];
    if (/^INSERT INTO admins \(empresa_id, email, nome, role, password\)/.test(sql)) { const id = ++S.seq.a; S.admins.push({ id, empresa_id: p[0], email: p[1], role: 'owner' }); return [{ insertId: id }]; }
    return origExec.call(this, sqlRaw, p);
  };
  process.env.JWT_SECRET = 'x';
  const r = res();
  await registro.registrarEmpresa({ body: { nome: 'Empresa Nova', email: 'dono@x.com', senha: '123456', tipo_pessoa: 'PF', cpf: '529.982.247-25', telefone: '93991935695', cep: '68000000', logradouro: 'Rua X', numero: '1', bairro: 'Centro', cidade: 'Santarem', uf: 'PA' } }, r);
  fakeDb.execute = origExec;
  assert.strictEqual(r.code, 201, JSON.stringify(r.body));
  const adminId = S.admins[0].id;
  assert.ok(S.ae.some((v) => v.admin_id === adminId && v.empresa_id === 9 && v.role === 'owner'));
  assert.deepStrictEqual(nomeGrupo(adminId), ['Acesso Completo']);
});
