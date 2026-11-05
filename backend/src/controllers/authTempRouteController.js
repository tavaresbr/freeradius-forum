const { gerarAcessoTemporario } = require("./authTempController");
const db = require("../../db");

async function gerarAcessoTemporarioHandler(req, res) {
  const { mac, ip: ipBody, plano_id, mikrotik_id } = req.body;
  const ip = ipBody || null; // opcional (AP Intelbras nao manda o IP do cliente)

  if (!mac || !plano_id) {
    return res.status(400).json({ error: "mac e plano_id sao obrigatorios" });
  }

  try {
    // Resolver empresa_id via plano ou mikrotik (endpoint público)
    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }
    if (!empresaId) {
      const [[plano]] = await db.execute("SELECT empresa_id FROM planos WHERE id = ?", [plano_id]);
      empresaId = plano?.empresa_id || null;
    }

    const resultado = await gerarAcessoTemporario(mac, ip, plano_id, empresaId);
    return res.json(resultado);
  } catch (err) {
    return res.status(500).json({ error: "Erro ao gerar acesso temporario" });
  }
}

module.exports = {
  gerarAcessoTemporarioHandler,
};
