const db = require("../../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { criarPortaisPadrao } = require("../utils/empresaSetup");
const { criarTrial } = require("../utils/assinatura");
const { atribuirPerfil } = require("../utils/perfis");

function gerarSlug(nome) {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

exports.registrarEmpresa = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { nome, email, cnpj, telefone, senha, plano_id } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({ message: "Nome, email e senha são obrigatórios" });
    }

    // Verificar se email já existe
    const [[existingAdmin]] = await conn.execute(
      "SELECT id FROM admins WHERE email = ?",
      [email]
    );
    if (existingAdmin) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    // Gerar slug único
    let slug = gerarSlug(nome);
    const [[existingSlug]] = await conn.execute(
      "SELECT id FROM empresas WHERE slug = ?",
      [slug]
    );
    if (existingSlug) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    await conn.beginTransaction();

    // Criar empresa
    const [empresaResult] = await conn.execute(
      `INSERT INTO empresas (nome, slug, cnpj, email, telefone) VALUES (?, ?, ?, ?, ?)`,
      [nome, slug, cnpj || null, email, telefone || null]
    );
    const empresaId = empresaResult.insertId;

    // Criar admin owner
    const hashedPassword = await bcrypt.hash(senha, 10);
    const [adminResult] = await conn.execute(
      `INSERT INTO admins (empresa_id, email, nome, role, password) VALUES (?, ?, ?, 'owner', ?)`,
      [empresaId, email, nome, hashedPassword]
    );
    const adminId = adminResult.insertId;

    // O login so aceita admins vinculados a empresa em admin_empresas, e sem grupo o
    // checkPermissao nega tudo: o dono da empresa nasce Administrador (Acesso Completo).
    await conn.execute(
      "INSERT INTO admin_empresas (admin_id, empresa_id, role) VALUES (?, ?, 'owner') ON DUPLICATE KEY UPDATE role = VALUES(role)",
      [adminId, empresaId]
    );
    await atribuirPerfil(conn, adminId, "administrador");

    // Portais padrao: sem eles os fluxos publicos (LGPD/lead/planos/login)
    // falham em silencio — resolucao por tipo nao encontra nada.
    await criarPortaisPadrao(conn, empresaId);

    // SaaS: toda empresa nova nasce em trial (7 dias) no plano escolhido
    await criarTrial(conn, empresaId, plano_id);

    await conn.commit();

    // Gerar token
    const token = jwt.sign(
      {
        id: adminId,
        email,
        empresa_id: empresaId,
        empresa_slug: slug,
        role: "owner",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(201).json({
      token,
      user: {
        id: adminId,
        email,
        nome,
        role: "owner",
        empresa_id: empresaId,
        empresa_slug: slug,
        empresa_nome: nome,
      },
      empresa: {
        id: empresaId,
        nome,
        slug,
        cnpj: cnpj || null,
        email,
        telefone: telefone || null,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error("Erro ao registrar empresa:", err);
    res.status(500).json({ message: "Erro ao registrar empresa", error: err.message });
  } finally {
    conn.release();
  }
};
