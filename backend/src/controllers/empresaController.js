const db = require("../../db");
const { criarPortaisPadrao, criarPlanosPadrao } = require("../utils/empresaSetup");
const { criarTrial } = require("../utils/assinatura");
const { atribuirPerfil, perfilDoAdmin } = require("../utils/perfis");
const { sanitizarEmpresa, cnpjDuplicado, MSG_CNPJ_DUPLICADO, cpfDuplicado, MSG_CPF_DUPLICADO } = require("../utils/empresaCadastro");

function gerarSlug(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

exports.listarEmpresas = async (req, res) => {
  try {
    const [empresas] = await db.query(`
      SELECT e.*,
        (SELECT COUNT(*) FROM admins WHERE empresa_id = e.id) AS total_admins,
        (SELECT COUNT(*) FROM mikrotiks WHERE empresa_id = e.id) AS total_mikrotiks,
        (SELECT COUNT(*) FROM planos WHERE empresa_id = e.id) AS total_planos,
        a.status AS assinatura_status, a.trial_ate, a.vence_em, a.plano_id AS assinatura_plano_id, sp.nome AS assinatura_plano_nome
      FROM empresas e
      LEFT JOIN assinaturas a ON a.empresa_id = e.id
      LEFT JOIN saas_planos sp ON sp.id = a.plano_id
      ORDER BY e.criado_em DESC
    `);
    res.json(empresas);
  } catch (err) {
    console.error("Erro ao listar empresas:", err);
    res.status(500).json({ message: "Erro ao listar empresas" });
  }
};

exports.criarEmpresa = async (req, res) => {
  try {
    const { nome, cnpj, email, telefone, plano_id } = req.body;
    if (!nome || !email) {
      return res.status(400).json({ message: "Nome e email são obrigatórios" });
    }

    const { dados: emp, erro } = sanitizarEmpresa(req.body);
    if (erro) return res.status(400).json({ message: erro });
    if (await cnpjDuplicado(db, emp.cnpj)) return res.status(409).json({ message: MSG_CNPJ_DUPLICADO });
    if (await cpfDuplicado(db, emp.cpf)) return res.status(409).json({ message: MSG_CPF_DUPLICADO });

    let slug = gerarSlug(nome);

    // Garantir slug único
    const [[existing]] = await db.execute('SELECT id FROM empresas WHERE slug = ?', [slug]);
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const [result] = await db.execute(
      `INSERT INTO empresas (nome, slug, cnpj, tipo_pessoa, cpf, email, telefone, razao_social, nome_fantasia, cep, logradouro, numero, complemento, bairro, cidade, uf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, slug, emp.cnpj, emp.tipo_pessoa, emp.cpf, email, emp.telefone, emp.razao_social, emp.nome_fantasia, emp.cep, emp.logradouro, emp.numero, emp.complemento, emp.bairro, emp.cidade, emp.uf]
    );

    const empresaId = result.insertId;

    // Auto-criar os 5 portais padrao (helper compartilhado com /api/registro).
    await criarPortaisPadrao(db, empresaId);
    await criarPlanosPadrao(db, empresaId);
    await criarTrial(db, empresaId, plano_id);

    res.status(201).json({ id: empresaId, nome, slug, email });
  } catch (err) {
    console.error("Erro ao criar empresa:", err);
    res.status(500).json({ message: "Erro ao criar empresa" });
  }
};

exports.atualizarEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, logo_url, ativo } = req.body;
    const { dados: emp, erro } = sanitizarEmpresa(req.body);
    if (erro) return res.status(400).json({ message: erro });
    if (await cnpjDuplicado(db, emp.cnpj, id)) return res.status(409).json({ message: MSG_CNPJ_DUPLICADO });
    if (await cpfDuplicado(db, emp.cpf, id)) return res.status(409).json({ message: MSG_CPF_DUPLICADO });

    await db.execute(
      `UPDATE empresas SET nome = ?, cnpj = ?, tipo_pessoa = ?, cpf = ?, email = ?, telefone = ?, logo_url = ?, ativo = ?,
         razao_social = ?, nome_fantasia = ?, cep = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, uf = ?
       WHERE id = ?`,
      [nome, emp.cnpj, emp.tipo_pessoa, emp.cpf, email, emp.telefone, logo_url || null, ativo !== undefined ? ativo : 1,
       emp.razao_social, emp.nome_fantasia, emp.cep, emp.logradouro, emp.numero, emp.complemento, emp.bairro, emp.cidade, emp.uf, id]
    );

    res.json({ message: "Empresa atualizada" });
  } catch (err) {
    console.error("Erro ao atualizar empresa:", err);
    res.status(500).json({ message: "Erro ao atualizar empresa" });
  }
};

exports.deletarEmpresa = async (req, res) => {
  try {
    const { id } = req.params;

    // Não permitir deletar empresa padrão
    const [[empresa]] = await db.execute('SELECT slug FROM empresas WHERE id = ?', [id]);
    if (empresa && empresa.slug === 'default') {
      return res.status(400).json({ message: "Não é possível deletar a empresa padrão" });
    }

    await db.execute('DELETE FROM empresas WHERE id = ?', [id]);
    res.json({ message: "Empresa deletada" });
  } catch (err) {
    console.error("Erro ao deletar empresa:", err);
    res.status(500).json({ message: "Erro ao deletar empresa" });
  }
};

exports.obterEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    const [[empresa]] = await db.execute('SELECT * FROM empresas WHERE id = ?', [id]);
    if (!empresa) {
      return res.status(404).json({ message: "Empresa não encontrada" });
    }
    res.json(empresa);
  } catch (err) {
    console.error("Erro ao obter empresa:", err);
    res.status(500).json({ message: "Erro ao obter empresa" });
  }
};

exports.listarAdminsEmpresa = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.execute(
      `SELECT a.id, a.email, a.nome, a.role AS role_global, ae.role AS role_empresa, ae.criado_em
       FROM admin_empresas ae
       JOIN admins a ON ae.admin_id = a.id
       WHERE ae.empresa_id = ?
       ORDER BY a.nome`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar admins da empresa:", err);
    res.status(500).json({ message: "Erro ao listar admins" });
  }
};

exports.vincularAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_id, role } = req.body;

    if (!admin_id) return res.status(400).json({ message: "admin_id obrigatório" });

    // Primeiro admin vinculado a empresa nasce Administrador (se ainda nao tem perfil).
    const [[{ outros }]] = await db.execute(
      'SELECT COUNT(*) AS outros FROM admin_empresas WHERE empresa_id = ? AND admin_id <> ?',
      [id, admin_id]
    );

    await db.execute(
      `INSERT INTO admin_empresas (admin_id, empresa_id, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [admin_id, id, role || 'operator']
    );

    if (Number(outros) === 0 && !(await perfilDoAdmin(db, admin_id))) {
      await atribuirPerfil(db, admin_id, 'administrador');
    }

    res.json({ message: "Admin vinculado com sucesso" });
  } catch (err) {
    console.error("Erro ao vincular admin:", err);
    res.status(500).json({ message: "Erro ao vincular admin" });
  }
};

exports.desvincularAdmin = async (req, res) => {
  try {
    const { id, adminId } = req.params;

    const [result] = await db.execute(
      'DELETE FROM admin_empresas WHERE admin_id = ? AND empresa_id = ?',
      [adminId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Vínculo não encontrado" });
    }

    res.json({ message: "Admin desvinculado" });
  } catch (err) {
    console.error("Erro ao desvincular admin:", err);
    res.status(500).json({ message: "Erro ao desvincular admin" });
  }
};

exports.listarTodosAdmins = async (req, res) => {
  try {
    // Isolamento multi-tenant: esta rota e montada tanto em /api/empresas
    // (super_admin) quanto em /api/grupos-permissao (super_admin OU owner).
    // Um owner NAO pode enxergar admins de outras empresas.
    if (req.user && req.user.role === 'super_admin') {
      const [rows] = await db.execute(
        'SELECT id, email, nome, role FROM admins ORDER BY nome'
      );
      return res.json(rows);
    }

    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(403).json({ message: "Empresa não identificada" });

    const [rows] = await db.execute(
      'SELECT id, email, nome, role FROM admins WHERE empresa_id = ? ORDER BY nome',
      [empresaId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar admins:", err);
    res.status(500).json({ message: "Erro ao listar admins" });
  }
};

