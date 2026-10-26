const { obterStatus, tabelaInexistente } = require("../utils/assinatura");

// Painel admin: empresa sem assinatura ativa (alem da carencia) recebe 402.
// super_admin nunca e' bloqueado. Erro de infraestrutura NAO derruba o painel.
module.exports = async (req, res, next) => {
  if (req.user?.role === "super_admin") return next();
  try {
    const st = await obterStatus(req.empresa_id);
    if (st.bloqueada) {
      return res.status(402).json({
        code: "ASSINATURA_VENCIDA",
        error: "Assinatura vencida. Renove para continuar usando o painel.",
        status: st.status,
      });
    }
  } catch (err) {
    if (!tabelaInexistente(err)) {
      // Falha fechada: erro de banco nao pode liberar o painel de empresa com assinatura vencida.
      console.error("[assinatura] erro no middleware:", err.message);
      return res.status(503).json({ error: "Erro ao verificar a assinatura. Tente novamente." });
    }
  }
  next();
};
