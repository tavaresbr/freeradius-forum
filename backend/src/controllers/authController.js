const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const Admin = require('../models/Admin')
const { getPermissoesConsolidadas, MODULOS } = require('./grupoPermissaoController')

// Role valida na empresa ativa: super_admin e a role "da casa" (admins.role) valem como estao; em outra
// empresa vale o papel do vinculo (admin_empresas.role). Antes a role global era levada para qualquer empresa
// (owner na A virava owner na B mesmo vinculado como operator).
function roleNaEmpresa(user, empresa) {
  if (user.role === 'super_admin') return 'super_admin'
  if (empresa && user.empresa_id && Number(empresa.id) !== Number(user.empresa_id) && empresa.role) return empresa.role
  return user.role || 'operator'
}
exports.roleNaEmpresa = roleNaEmpresa

// Hash descartavel: e-mail inexistente tambem paga o custo do bcrypt, senao o tempo de resposta
// revela quais e-mails tem conta (enumeracao por timing).
const HASH_FALSO = bcrypt.hashSync('senha-inexistente', 10)

exports.login = async (req, res) => {
  try {
    return await loginInterno(req, res)
  } catch (err) {
    console.error('Erro no login:', err.message)
    return res.status(500).json({ error: 'Erro interno no servidor' })
  }
}

async function loginInterno(req, res) {
  const { email, password, senha } = req.body || {}
  const pass = password || senha
  // Limites de tamanho: evita bcrypt/consulta com entrada gigante (e senha acima de 72 bytes e' truncada pelo bcrypt)
  if (typeof email !== 'string' || typeof pass !== 'string' || !email || !pass || email.length > 254 || pass.length > 256) {
    return res.status(401).json({ error: 'Credenciais inválidas' })
  }
  const user = await Admin.findByEmail(email.trim())

  // Mesma resposta (e mesmo custo de CPU) para e-mail inexistente e senha errada (nao enumera usuarios).
  const match = await bcrypt.compare(pass, user ? user.password : HASH_FALSO)
  if (!user || !match) return res.status(401).json({ error: 'Credenciais inválidas' })

  // Buscar todas as empresas do usuário
  const empresas = await Admin.getEmpresas(user.id, user.role);

  if (empresas.length === 0) {
    return res.status(403).json({ error: 'Você não possui vínculo com nenhuma empresa ativa' });
  }

  // Empresa ativa = a do JWT antigo (empresa_id do admin) ou primeira da lista
  const empresaAtiva = empresas.find(e => e.id === user.empresa_id) || empresas[0] || null;

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      empresa_id: empresaAtiva?.id || user.empresa_id,
      empresa_slug: empresaAtiva?.slug || user.empresa_slug || 'default',
      empresa_nome: empresaAtiva?.nome || user.empresa_nome || 'Empresa Padrão',
      role: roleNaEmpresa(user, empresaAtiva)
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  )

  // Buscar permissões consolidadas do admin
  let permissoes = {};
  if (user.role === 'super_admin') {
    for (const m of MODULOS) permissoes[m] = { ver: true, criar: true, editar: true, excluir: true };
  } else {
    permissoes = await getPermissoesConsolidadas(user.id);
  }

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      role: roleNaEmpresa(user, empresaAtiva),
      empresa_id: empresaAtiva?.id || user.empresa_id,
      empresa_slug: empresaAtiva?.slug || user.empresa_slug || 'default',
      empresa_nome: empresaAtiva?.nome || user.empresa_nome || 'Empresa Padrão'
    },
    empresas,
    permissoes
  })
}

exports.switchEmpresa = async (req, res) => {
  try {
    const { empresa_id } = req.body;
    const adminId = req.user.id;

    // Verificar que o admin tem acesso a essa empresa
    const empresas = await Admin.getEmpresas(adminId, req.user.role);
    const empresa = empresas.find(e => e.id === parseInt(empresa_id));

    // Super admin pode acessar qualquer empresa
    if (!empresa && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Sem acesso a esta empresa' });
    }

    // Se super_admin e empresa não está na lista, busca direto
    let empresaData = empresa;
    if (!empresaData) {
      const db = require('../../db');
      const [[emp]] = await db.execute('SELECT id, nome, slug FROM empresas WHERE id = ?', [empresa_id]);
      if (!emp) return res.status(404).json({ error: 'Empresa não encontrada' });
      empresaData = emp;
    }

    // Role/empresa "da casa" vem do banco (o token pode ja carregar o papel de outra empresa).
    const home = await Admin.findById(adminId)

    const newToken = jwt.sign(
      {
        id: adminId,
        email: req.user.email,
        empresa_id: empresaData.id,
        empresa_slug: empresaData.slug,
        empresa_nome: empresaData.nome,
        role: roleNaEmpresa(home || { role: req.user.role }, empresaData)
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token: newToken,
      empresa: {
        id: empresaData.id,
        nome: empresaData.nome,
        slug: empresaData.slug
      },
      empresas
    });
  } catch (err) {
    console.error('Erro ao trocar empresa:', err);
    res.status(500).json({ error: 'Erro ao trocar empresa' });
  }
}
