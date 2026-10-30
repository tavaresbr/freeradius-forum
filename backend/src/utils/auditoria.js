// Log de auditoria do painel: quem fez o que. Gravado DEPOIS da resposta (so se deu certo) e nunca derruba a requisicao.
// Nao guarda corpo de requisicao, senha, CPF nem token: so a acao, a entidade e (quando util) uma contagem.
const db = require("../../db");

// [metodo, regex do caminho (sem query), acao, entidade]
const REGRAS = [
  ["DELETE", /^\/api\/leads\/massa$/, "cliente.excluir_massa", "cliente"],
  ["PUT", /^\/api\/leads\/massa$/, "cliente.editar_massa", "cliente"],
  ["DELETE", /^\/api\/leads\/(\d+)$/, "cliente.excluir", "cliente"],
  ["GET", /^\/api\/leads\/export$/, "cliente.exportar", "cliente"],
  ["GET", /^\/api\/leads\/export-contatos$/, "cliente.exportar", "cliente"],
  ["GET", /^\/api\/lgpd\/export-contatos$/, "cliente.exportar", "cliente"],
  ["POST", /^\/api\/planos$/, "plano.criar", "plano"],
  ["PUT", /^\/api\/planos\/(\d+)$/, "plano.editar", "plano"],
  ["DELETE", /^\/api\/planos\/(\d+)$/, "plano.excluir", "plano"],
  ["POST", /^\/api\/admins$/, "usuario.criar", "usuario"],
  ["PUT", /^\/api\/admins\/(\d+)$/, "usuario.editar", "usuario"],
  ["DELETE", /^\/api\/admins\/(\d+)$/, "usuario.excluir", "usuario"],
  ["POST", /^\/api\/mikrotiks$/, "equipamento.criar", "equipamento"],
  ["PUT", /^\/api\/mikrotiks\/(\d+)$/, "equipamento.editar", "equipamento"],
  ["DELETE", /^\/api\/mikrotiks\/(\d+)$/, "equipamento.excluir", "equipamento"],
  ["DELETE", /^\/api\/portais\/(\d+)$/, "portal.excluir", "portal"],
  ["POST", /^\/api\/empresa-config\/([a-z_]+)$/, "config.salvar", "config"],
  ["PUT", /^\/api\/empresa-config\/([a-z_]+)$/, "config.salvar", "config"],
  ["POST", /^\/api\/config-mercadopago$/, "config.salvar", "mercadopago"],
  ["POST", /^\/api\/efi$/, "config.salvar", "efi"],
  ["POST", /^\/api\/whatsapp\/config$/, "config.salvar", "whatsapp"],
  ["PUT", /^\/api\/atendimento\/automacao$/, "config.salvar", "automacao"],
  ["PUT", /^\/api\/atendimento\/aviso-expiracao$/, "config.salvar", "aviso_expiracao"],
  ["PUT", /^\/api\/alertas-equipamentos$/, "config.salvar", "alerta_equipamentos"],
  ["PUT", /^\/api\/atendimento\/chatbot$/, "config.salvar", "chatbot"],
  ["PUT", /^\/api\/atendimento\/pos-compra$/, "config.salvar", "pos_compra"],
  ["PUT", /^\/api\/atendimento\/renovacao$/, "config.salvar", "renovacao"],
  ["PUT", /^\/api\/atendimento\/nao-perturbe\/config$/, "config.salvar", "nao_perturbe"],
  ["POST", /^\/api\/atendimento\/nao-perturbe$/, "nao_perturbe.adicionar", "nao_perturbe"],
  ["POST", /^\/api\/atendimento\/nao-perturbe\/importar$/, "nao_perturbe.importar", "nao_perturbe"],
  ["DELETE", /^\/api\/atendimento\/nao-perturbe\/(\d+)$/, "nao_perturbe.remover", "nao_perturbe"],
  ["POST", /^\/api\/limpeza\/([a-z_-]+)$/, "limpeza.executar", "limpeza"],
  ["DELETE", /^\/api\/limpeza\/([a-z_-]+)$/, "limpeza.executar", "limpeza"],
  ["POST", /^\/api\/cupons$/, "cupom.criar", "cupom"],
  ["PUT", /^\/api\/cupons\/\d+$/, "cupom.editar", "cupom"],
  ["DELETE", /^\/api\/cupons\/\d+$/, "cupom.excluir", "cupom"],
  ["POST", /^\/api\/vouchers\/massa(-filtro)?$/, "voucher.massa", "voucher"],
  ["POST", /^\/api\/promocoes-whatsapp\/(\d+)\/iniciar$/, "promocao.iniciar", "promocao"],
  ["POST", /^\/api\/avisos-operacionais\/(\d+)\/iniciar$/, "aviso_operacional.iniciar", "aviso_operacional"],
];

/** { acao, entidade, id } da requisicao, ou null se nao e' auditada. Puro (testavel). */
function classificar(metodo, caminho) {
  for (const [m, re, acao, entidade] of REGRAS) {
    if (m !== metodo) continue;
    const r = re.exec(caminho);
    if (r) return { acao, entidade, id: r[1] && !/^-/.test(r[1]) ? String(r[1]).slice(0, 60) : null };
  }
  return null;
}

async function registrar(req, acao, entidade, entidadeId, detalhes) {
  try {
    if (!req.empresa_id) return;
    await db.query(
      "INSERT INTO audit_logs (empresa_id, admin_id, acao, entidade, entidade_id, detalhes, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.empresa_id, req.user?.id || null, String(acao).slice(0, 60), entidade ? String(entidade).slice(0, 60) : null,
        entidadeId ? String(entidadeId).slice(0, 60) : null, detalhes ? String(detalhes).slice(0, 500) : null,
        String(req.ip || "").replace(/^::ffff:/, "").slice(0, 45) || null]
    );
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") console.warn("[auditoria] nao gravou:", err.message);
  }
}

/** Middleware global de /api: ao terminar uma requisicao autenticada e bem-sucedida que casa uma regra, registra. */
function auditoriaMiddleware(req, res, next) {
  const caminho = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
  const regra = classificar(req.method, caminho);
  if (regra) {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 400 || !req.user) return;
      let detalhes = null;
      const n = Array.isArray(req.body?.ids) ? req.body.ids.length : null;
      if (n) detalhes = `${n} registro(s)`;
      registrar(req, regra.acao, regra.entidade, regra.id, detalhes);
    });
  }
  next();
}

module.exports = { REGRAS, classificar, registrar, auditoriaMiddleware };
