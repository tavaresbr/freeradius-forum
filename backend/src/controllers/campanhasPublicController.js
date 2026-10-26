const db = require("../../db");
const { campanhaAtivaDoPortal } = require("../utils/campanhaAtiva");

/**
 * Retorna a campanha ativa de um portal, incluindo seus itens.
 * Rota pública — sem autenticação.
 */
exports.obterPorPortal = async (req, res) => {
  const { portalId } = req.params;
  try {
    // 1. Buscar portal
    const [[portal]] = await db.execute(
      "SELECT id, empresa_id, campanha_ativa_id FROM portais WHERE id = ?",
      [portalId]
    );
    if (!portal || !portal.campanha_ativa_id) {
      return res.status(404).json({ error: "Sem campanha ativa" });
    }

    // 2. Buscar campanha (valida empresa e ativo=1)
    const [[campanha]] = await db.execute(
      "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ? AND ativo = 1",
      [portal.campanha_ativa_id, portal.empresa_id]
    );
    if (!campanha) {
      return res.status(404).json({ error: "Sem campanha ativa" });
    }

    // 3. Buscar itens ordenados
    const [itens] = await db.execute(
      `SELECT id, tipo, ordem, arquivo_url, duracao_segundos, titulo, link_destino
         FROM campanha_itens
        WHERE campanha_id = ?
        ORDER BY ordem ASC, id ASC`,
      [campanha.id]
    );
    if (itens.length === 0) {
      return res.status(404).json({ error: "Sem campanha ativa" });
    }

    return res.json({
      success: true,
      data: {
        id:    campanha.id,
        nome:  campanha.nome,
        itens,
      },
    });
  } catch (err) {
    console.error("Erro ao obter campanha por portal:", err);
    res.status(500).json({ error: "Erro ao obter campanha" });
  }
};

/**
 * Registra uma visualização na campanha ativa do portal.
 * Rota pública — sem autenticação.
 */
exports.registrarView = async (req, res) => {
  const { portalId } = req.params;
  try {
    // 1. Buscar campanha_ativa_id do portal
    const [[portal]] = await db.execute(
      "SELECT campanha_ativa_id, empresa_id FROM portais WHERE id = ?",
      [portalId]
    );
    // Sem campanha utilizavel (ausente, inativa ou sem itens) — nao e erro, apenas ignora
    if (!portal || !portal.campanha_ativa_id || !(await campanhaAtivaDoPortal(portalId))) {
      return res.json({ success: true, skipped: true });
    }

    // 2. Incrementar views
    await db.execute(
      "UPDATE campanhas SET views = views + 1 WHERE id = ? AND empresa_id = ?",
      [portal.campanha_ativa_id, portal.empresa_id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar view da campanha:", err);
    res.status(500).json({ error: "Erro ao registrar view" });
  }
};
