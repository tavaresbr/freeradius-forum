const jwt = require('jsonwebtoken')

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization
  // Somente header Authorization: Bearer <token>. Token via query string
  // (?token=) foi removido por vazar em logs/histórico do navegador.
  const token = authHeader ? authHeader.split(' ')[1] : null;

  if (!token) return res.status(401).json({ error: 'Token não fornecido' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    // Token de download (?token=, 120s) vale so nas rotas de download/preview, nunca como sessao.
    if (decoded.purpose) return res.status(403).json({ error: 'Token inválido' })
    req.user = decoded
    next()
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido' })
  }
}
