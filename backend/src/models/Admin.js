const db = require('../../db');

const findByEmail = async (email) => {
  const [rows] = await db.execute(
    `SELECT a.*, e.slug AS empresa_slug, e.nome AS empresa_nome
     FROM admins a
     LEFT JOIN empresas e ON a.empresa_id = e.id
     WHERE a.email = ?`,
    [email]
  );
  return rows[0];
};

// empresa_id ausente NAO retorna mais a base inteira por acidente (vazamento
// cross-tenant). Somente super_admin pode listar sem escopo, e apenas passando
// { includeAll: true } explicitamente.
const findAll = async (empresa_id, { includeAll = false } = {}) => {
  if (!empresa_id) {
    if (!includeAll) return [];
    const [rows] = await db.execute('SELECT id, email, nome, role, empresa_id, created_at FROM admins ORDER BY id DESC');
    return rows;
  }
  const [rows] = await db.execute(
    'SELECT id, email, nome, role, empresa_id, created_at FROM admins WHERE empresa_id = ? ORDER BY id DESC',
    [empresa_id]
  );
  return rows;
};

const findById = async (id) => {
  const [rows] = await db.execute('SELECT id, email, nome, role, empresa_id FROM admins WHERE id = ?', [id]);
  return rows[0];
};

const create = async (email, passwordHash, empresa_id, role = 'operator', nome = null) => {
  const [result] = await db.execute(
    'INSERT INTO admins (empresa_id, email, password, nome, role) VALUES (?, ?, ?, ?, ?)',
    [empresa_id, email, passwordHash, nome, role]
  );
  // O login so aceita admins vinculados a uma empresa em admin_empresas (getEmpresas);
  // sem este vinculo o admin criado pela tela Usuarios nunca conseguia entrar.
  if (empresa_id) {
    await db.execute(
      `INSERT INTO admin_empresas (admin_id, empresa_id, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [result.insertId, empresa_id, role]
    );
  }
  return result.insertId;
};

// empresaId: quando fornecido, escopa a operacao a uma empresa (isolamento
// multi-tenant). Passar null/undefined (apenas para super_admin) opera sem escopo.
const update = async (id, email, nome = null, empresaId = null) => {
  if (empresaId == null) {
    const [result] = await db.execute('UPDATE admins SET email = ?, nome = ? WHERE id = ?', [email, nome, id]);
    return result;
  }
  const [result] = await db.execute(
    'UPDATE admins SET email = ?, nome = ? WHERE id = ? AND empresa_id = ?',
    [email, nome, id, empresaId]
  );
  return result;
};

const updatePassword = async (id, passwordHash, empresaId = null) => {
  if (empresaId == null) {
    const [result] = await db.execute("UPDATE admins SET password = ? WHERE id = ?", [passwordHash, id]);
    return result;
  }
  const [result] = await db.execute(
    "UPDATE admins SET password = ? WHERE id = ? AND empresa_id = ?",
    [passwordHash, id, empresaId]
  );
  return result;
};

const remove = async (id, empresaId = null) => {
  if (empresaId == null) {
    const [result] = await db.execute('DELETE FROM admins WHERE id = ?', [id]);
    return result;
  }
  const [result] = await db.execute('DELETE FROM admins WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return result;
};

const getEmpresas = async (adminId, role) => {
  if (role === 'super_admin') {
    const [rows] = await db.execute(
      `SELECT id, nome, slug, cnpj, email, logo_url, 'owner' AS role
       FROM empresas
       WHERE ativo = 1
       ORDER BY nome`
    );
    return rows;
  }

  const [rows] = await db.execute(
    `SELECT e.id, e.nome, e.slug, e.cnpj, e.email, e.logo_url, ae.role
     FROM admin_empresas ae
     JOIN empresas e ON ae.empresa_id = e.id
     WHERE ae.admin_id = ? AND e.ativo = 1
     ORDER BY e.nome`,
    [adminId]
  );
  return rows;
};

module.exports = {
  findByEmail,
  findAll,
  findById,
  create,
  update,
  remove,
  updatePassword,
  getEmpresas,
};
