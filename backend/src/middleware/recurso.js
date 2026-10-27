const { temRecurso } = require("../utils/assinatura");

const ROTULOS = { whatsapp: "WhatsApp", campanhas: "Campanhas", exportacao: "Exportação da base", dominio: "Domínio próprio" };

// Usar depois de `tenant`: bloqueia (403) empresa cujo plano/adicionais nao incluem o recurso.
// super_admin nunca e' bloqueado; erro de banco falha fechado (503); migration ausente libera.
module.exports = (recurso) => async function exigeRecurso(req, res, next) {
  if (req.user?.role === "super_admin") return next();
  try {
    if (await temRecurso(req.empresa_id, recurso)) return next();
    return res.status(403).json({
      code: "RECURSO_NAO_CONTRATADO",
      recurso,
      error: `${ROTULOS[recurso] || recurso} não está incluído no seu plano. Contrate o plano ou o adicional.`,
      message: `${ROTULOS[recurso] || recurso} não está incluído no seu plano. Contrate o plano ou o adicional.`,
    });
  } catch (err) {
    console.error("[recurso] erro ao verificar:", err.message);
    return res.status(503).json({ error: "Erro ao verificar o plano. Tente novamente." });
  }
};
