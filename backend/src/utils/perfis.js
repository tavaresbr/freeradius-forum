/**
 * Perfis de usuario do sistema.
 *
 * Perfil = grupo de permissao (grupos_permissao). Os grupos sao GLOBAIS (sem empresa_id) e so o
 * super_admin gere grupos customizados (routes/grupoPermissaoRoutes.js); donos de empresa
 * escolhem apenas entre os dois perfis abaixo:
 *   - administrador -> grupo "Acesso Completo" (criado na migration 018): todos os modulos
 *   - padrao        -> grupo "Usuário Padrão": operacional, sem administracao
 *
 * Todo caminho que cria admin TEM que passar por atribuirPerfil: sem grupo o checkPermissao
 * nega tudo (deny-by-default) e o painel fica inutilizavel.
 */
const { MODULOS } = require('../controllers/grupoPermissaoController');

const PERFIS = {
  administrador: {
    chave: 'administrador',
    nome: 'Acesso Completo',
    rotulo: 'Administrador',
    descricao: 'Acesso total a todos os módulos, inclusive Usuários e Configurações.',
    grupoDescricao: 'Acesso total a todos os modulos (atribuido automaticamente)',
  },
  padrao: {
    chave: 'padrao',
    nome: 'Usuário Padrão',
    rotulo: 'Usuário Padrão',
    descricao: 'Operação do dia a dia: Dashboard, Clientes, Leads, Pagamentos, Radius e Sessões (sem excluir).',
    grupoDescricao: 'Perfil operacional padrao: opera clientes, leads, pagamentos, radius e sessoes; sem administracao',
  },
};

const NOMES_PERFIS = Object.values(PERFIS).map((p) => p.nome);

const OP = { ver: 1, criar: 1, editar: 1, excluir: 0 };
// Modulos ausentes = negado.
const PERMISSOES_PADRAO = {
  dashboard: { ver: 1, criar: 0, editar: 0, excluir: 0 },
  clientes: OP,
  leads: OP,
  radius: OP,
  pagamentos: OP,
  sessoes: OP,
  sessoeslog: OP,
};

const PERMISSAO_TOTAL = { ver: 1, criar: 1, editar: 1, excluir: 1 };

function permissoesDoPerfil(chave) {
  if (chave === 'administrador') return Object.fromEntries(MODULOS.map((m) => [m, PERMISSAO_TOTAL]));
  return PERMISSOES_PADRAO;
}

const perfilValido = (chave) => Object.prototype.hasOwnProperty.call(PERFIS, chave);

/**
 * Garante o grupo do perfil (cria grupo + permissoes se faltar) e devolve o id.
 * Se o grupo ja existe so completa modulos que faltam (INSERT), nunca sobrescreve permissao
 * ja ajustada pelo super admin.
 * @param {Object} executor pool `db` ou connection de transacao
 */
async function garantirPerfil(executor, chave) {
  const perfil = PERFIS[chave];
  if (!perfil) throw new Error(`Perfil desconhecido: ${chave}`);

  const [[existente]] = await executor.execute('SELECT id FROM grupos_permissao WHERE nome = ? LIMIT 1', [perfil.nome]);
  let grupoId;
  if (existente) {
    grupoId = existente.id;
  } else {
    const [r] = await executor.execute('INSERT INTO grupos_permissao (nome, descricao) VALUES (?, ?)', [perfil.nome, perfil.grupoDescricao]);
    grupoId = r.insertId;
  }

  for (const [modulo, p] of Object.entries(permissoesDoPerfil(chave))) {
    if (!MODULOS.includes(modulo)) continue;
    const [[ja]] = await executor.execute('SELECT id FROM grupo_permissoes WHERE grupo_id = ? AND modulo = ? LIMIT 1', [grupoId, modulo]);
    if (!ja) {
      await executor.execute(
        'INSERT INTO grupo_permissoes (grupo_id, modulo, ver, criar, editar, excluir) VALUES (?, ?, ?, ?, ?, ?)',
        [grupoId, modulo, p.ver, p.criar, p.editar, p.excluir]
      );
    }
  }
  return grupoId;
}

/**
 * Define o perfil do admin: tira os vinculos com os DOIS grupos do sistema e vincula o escolhido.
 * Grupos customizados atribuidos pelo super admin ficam como estao.
 */
async function atribuirPerfil(executor, adminId, chave) {
  const grupoId = await garantirPerfil(executor, chave);
  const outra = chave === 'administrador' ? 'padrao' : 'administrador';
  const [[outro]] = await executor.execute('SELECT id FROM grupos_permissao WHERE nome = ? LIMIT 1', [PERFIS[outra].nome]);
  if (outro) await executor.execute('DELETE FROM admin_grupos WHERE admin_id = ? AND grupo_id = ?', [adminId, outro.id]);
  await executor.execute('INSERT IGNORE INTO admin_grupos (admin_id, grupo_id) VALUES (?, ?)', [adminId, grupoId]);
  return grupoId;
}

/** Quantos admins da empresa tem o perfil Administrador (por empresa_id do admin). */
async function contarAdministradores(executor, empresaId) {
  const [[row]] = await executor.execute(
    `SELECT COUNT(DISTINCT a.id) AS n
       FROM admins a
       JOIN admin_grupos ag ON ag.admin_id = a.id
       JOIN grupos_permissao g ON g.id = ag.grupo_id
      WHERE a.empresa_id = ? AND g.nome = ?`,
    [empresaId, PERFIS.administrador.nome]
  );
  return Number(row.n) || 0;
}

/** Chave do perfil de sistema que o admin tem ('administrador' ganha de 'padrao'), ou null. */
async function perfilDoAdmin(executor, adminId) {
  const [rows] = await executor.execute(
    `SELECT g.nome FROM admin_grupos ag JOIN grupos_permissao g ON g.id = ag.grupo_id
      WHERE ag.admin_id = ? AND g.nome IN (?, ?)`,
    [adminId, PERFIS.administrador.nome, PERFIS.padrao.nome]
  );
  const nomes = rows.map((r) => r.nome);
  if (nomes.includes(PERFIS.administrador.nome)) return 'administrador';
  if (nomes.includes(PERFIS.padrao.nome)) return 'padrao';
  return null;
}

module.exports = {
  PERFIS, NOMES_PERFIS, PERMISSOES_PADRAO, perfilValido,
  garantirPerfil, atribuirPerfil, contarAdministradores, perfilDoAdmin,
};
