const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const { checarLimiteSeguro } = require("../utils/assinatura");

// Hierarquia de roles (maior = mais privilegio). Um ator so pode
// criar/editar/atribuir roles com rank <= ao proprio, e nunca modificar
// um admin de role superior. super_admin passa por todos os checks.
const ROLE_RANK = { operator: 1, manager: 2, owner: 3, super_admin: 4 };

const rankOf = (role) => ROLE_RANK[role] || 0;

// Ator pode atribuir/gerenciar um alvo com role <= ao proprio.
const podeGerenciarRole = (actorRole, targetRole) => rankOf(actorRole) >= rankOf(targetRole);

// Escopo multi-tenant: super_admin opera sem escopo (null), demais ficam
// presos a propria empresa.
const escopoEmpresa = (req) => (req.user.role === 'super_admin' ? null : req.empresa_id);

const listarAdmins = async (req, res) => {
  // super_admin sem empresa selecionada pode ver a base inteira (opt-in
  // explicito); demais ficam escopados a propria empresa pelo model.
  const includeAll = req.user.role === 'super_admin';
  const admins = await Admin.findAll(req.empresa_id, { includeAll });
  res.json(admins);
};

const criarAdmin = async (req, res) => {
  const { email, senha, nome, role } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ message: "Email e senha são obrigatórios" });
  }

  const allowedRole = role || 'operator';
  if (!ROLE_RANK[allowedRole]) {
    return res.status(400).json({ message: "Role inválida" });
  }

  // Impede escalonamento: role inferior nao pode criar/elevar para role superior.
  if (!podeGerenciarRole(req.user.role, allowedRole)) {
    return res.status(403).json({ message: "Você não pode criar um administrador com role superior à sua" });
  }

  try {
    const lim = await checarLimiteSeguro(req.empresa_id, "admins");
    if (!lim.ok) return res.status(403).json({ message: lim.mensagem });

    const hash = await bcrypt.hash(senha, 10);
    await Admin.create(email, hash, req.empresa_id, allowedRole, nome || null);
    res.status(201).json({ message: "Administrador criado com sucesso" });
  } catch (err) {
    console.error("Erro ao criar admin:", err);
    res.status(500).json({ message: "Erro interno ao criar administrador" });
  }
};

const atualizarAdmin = async (req, res) => {
  const { id } = req.params;
  const { email, senha, nome, role } = req.body;

  if (!email) return res.status(400).json({ message: "Email é obrigatório" });

  const alvo = await Admin.findById(id);
  if (!alvo) return res.status(404).json({ message: "Administrador não encontrado" });

  // Isolamento multi-tenant: nao-super so mexe na propria empresa.
  if (req.user.role !== 'super_admin' && Number(alvo.empresa_id) !== Number(req.empresa_id)) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }

  // Nao pode modificar admin de role superior a sua.
  if (!podeGerenciarRole(req.user.role, alvo.role)) {
    return res.status(403).json({ message: "Você não pode modificar um administrador com role superior à sua" });
  }

  // Se tentar trocar a role, precisa poder atribuir a nova role.
  if (role && !podeGerenciarRole(req.user.role, role)) {
    return res.status(403).json({ message: "Você não pode atribuir uma role superior à sua" });
  }

  const empresaId = escopoEmpresa(req);
  const result = await Admin.update(id, email, nome || null, empresaId);
  if (result && result.affectedRows === 0) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }

  if (senha) {
    const hash = await bcrypt.hash(senha, 10);
    await Admin.updatePassword(id, hash, empresaId);
  }

  res.json({ message: "Administrador atualizado com sucesso" });
};

const deletarAdmin = async (req, res) => {
  const { id } = req.params;

  const alvo = await Admin.findById(id);
  if (!alvo) return res.status(404).json({ message: "Administrador não encontrado" });

  if (req.user.role !== 'super_admin' && Number(alvo.empresa_id) !== Number(req.empresa_id)) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }

  if (!podeGerenciarRole(req.user.role, alvo.role)) {
    return res.status(403).json({ message: "Você não pode remover um administrador com role superior à sua" });
  }

  const result = await Admin.remove(id, escopoEmpresa(req));
  if (result && result.affectedRows === 0) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }
  res.json({ message: "Administrador removido com sucesso" });
};

module.exports = {
  listarAdmins,
  criarAdmin,
  atualizarAdmin,
  deletarAdmin,
};
