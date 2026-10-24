const db = require('../../db');

module.exports = async (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  if (user.role === 'super_admin') {
    // Super admin: usa header x-empresa-id, ou empresa_id do JWT (set via switchEmpresa)
    const headerEmpresa = req.headers['x-empresa-id'] || req.query.empresa_id;
    const empresaId = headerEmpresa || user.empresa_id;
    // Aceita so inteiros puros: parseInt('8abc') daria 8 e aceitaria header malformado.
    req.empresa_id = empresaId
      ? (/^\d+$/.test(String(empresaId)) ? parseInt(empresaId, 10) : NaN)
      : null;

    // Se o super_admin informou uma empresa via header/query, validar que ela
    // existe (evita operar sobre empresa_id arbitrario/inexistente).
    if (headerEmpresa != null && headerEmpresa !== '') {
      if (!req.empresa_id || Number.isNaN(req.empresa_id)) {
        return res.status(400).json({ error: 'empresa_id inválido' });
      }
      try {
        const [[empresa]] = await db.execute('SELECT id FROM empresas WHERE id = ? LIMIT 1', [req.empresa_id]);
        if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
      } catch (err) {
        console.error('Erro ao validar empresa (tenant):', err);
        return res.status(500).json({ error: 'Erro ao resolver empresa' });
      }
    }
  } else {
    req.empresa_id = user.empresa_id;
  }

  if (!req.empresa_id && user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Empresa não identificada' });
  }

  next();
};
