const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const { checarLimiteSeguro } = require("../utils/assinatura");
const db = require("../../db");
const { PERFIS, perfilValido, atribuirPerfil, contarAdministradores, perfilDoAdmin } = require("../utils/perfis");

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

// Perfis que o usuario logado pode escolher (so os 2 do sistema; grupos sao globais).
const listarPerfis = (req, res) => {
  res.json(Object.values(PERFIS).map((p) => ({ chave: p.chave, nome: p.rotulo, descricao: p.descricao })));
};

const criarAdmin = async (req, res) => {
  const { email, senha, nome, role } = req.body;
  let { perfil } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ message: "Email e senha são obrigatórios" });
  }

  if (perfil !== undefined && !perfilValido(perfil)) {
    return res.status(400).json({ message: "Perfil inválido" });
  }
  perfil = perfil || 'padrao';

  // Primeiro usuario da empresa e' SEMPRE administrador (senao ninguem conseguiria gerir a empresa).
  let primeiroDaEmpresa;
  try {
    const [[{ total }]] = await db.execute(
      "SELECT COUNT(*) AS total FROM admins WHERE empresa_id = ? AND role <> 'super_admin'",
      [req.empresa_id]
    );
    primeiroDaEmpresa = Number(total) === 0;
  } catch (err) {
    console.error("Erro ao contar admins da empresa:", err);
    return res.status(500).json({ message: "Erro interno ao criar administrador" });
  }
  if (primeiroDaEmpresa) perfil = 'administrador';

  const allowedRole = (primeiroDaEmpresa ? 'owner' : role) || (perfil === 'administrador' ? 'owner' : 'operator');
  if (!ROLE_RANK[allowedRole]) {
    return res.status(400).json({ message: "Role inválida" });
  }

  // Impede escalonamento: role inferior nao pode criar/elevar para role superior.
  if (!podeGerenciarRole(req.user.role, allowedRole)) {
    return res.status(403).json({ message: "Você não pode criar um administrador com role superior à sua" });
  }

  // Administrador (acesso completo) so quem tem role de dono ou acima concede.
  if (perfil === 'administrador' && !podeGerenciarRole(req.user.role, 'owner')) {
    return res.status(403).json({ message: "Apenas o dono da empresa pode criar um Administrador" });
  }

  try {
    const lim = await checarLimiteSeguro(req.empresa_id, "admins");
    if (!lim.ok) return res.status(403).json({ message: lim.mensagem });

    const hash = await bcrypt.hash(senha, 10);
    const novoId = await Admin.create(email, hash, req.empresa_id, allowedRole, nome || null);
    await atribuirPerfil(db, novoId, perfil);
    res.status(201).json({ message: "Administrador criado com sucesso" });
  } catch (err) {
    console.error("Erro ao criar admin:", err);
    res.status(500).json({ message: "Erro interno ao criar administrador" });
  }
};

const atualizarAdmin = async (req, res) => {
  const { id } = req.params;
  const { email, senha, nome, role, perfil } = req.body;

  if (!email) return res.status(400).json({ message: "Email é obrigatório" });
  if (perfil !== undefined && !perfilValido(perfil)) {
    return res.status(400).json({ message: "Perfil inválido" });
  }

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

  // Troca de perfil: so Administrador concede Administrador, e a empresa nunca fica sem um.
  let mudarPerfil = false;
  if (perfil !== undefined) {
    if (perfil === 'administrador' && !podeGerenciarRole(req.user.role, 'owner')) {
      return res.status(403).json({ message: "Apenas o dono da empresa pode conceder o perfil Administrador" });
    }
    const atual = await perfilDoAdmin(db, alvo.id);
    if (atual === 'administrador' && perfil !== 'administrador' && (await contarAdministradores(db, alvo.empresa_id)) <= 1) {
      return res.status(400).json({ message: "A empresa precisa de ao menos um Administrador" });
    }
    mudarPerfil = atual !== perfil;
  }

  const empresaId = escopoEmpresa(req);
  const result = await Admin.update(id, email, nome || null, empresaId);
  if (result && result.affectedRows === 0) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }

  if (mudarPerfil) {
    await atribuirPerfil(db, alvo.id, perfil);
    // A role acompanha o perfil (dono x operador), salvo role explicita; super_admin nunca e' rebaixado.
    if (alvo.role !== 'super_admin') {
      await Admin.updateRole(alvo.id, role || (perfil === 'administrador' ? 'owner' : 'operator'), empresaId);
    }
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

  // Nao remove o ultimo Administrador da empresa.
  if ((await perfilDoAdmin(db, alvo.id)) === 'administrador' && (await contarAdministradores(db, alvo.empresa_id)) <= 1) {
    return res.status(400).json({ message: "A empresa precisa de ao menos um Administrador" });
  }

  const result = await Admin.remove(id, escopoEmpresa(req));
  if (result && result.affectedRows === 0) {
    return res.status(404).json({ message: "Administrador não encontrado" });
  }
  res.json({ message: "Administrador removido com sucesso" });
};

module.exports = {
  listarAdmins,
  listarPerfis,
  criarAdmin,
  atualizarAdmin,
  deletarAdmin,
};
