const db = require("../../db");
const { campanhaAtivaDoPortal, campanhaAtivaInfo } = require("../utils/campanhaAtiva");
const { criarDedupe } = require("../utils/dedupeTtl");

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

    // 2. Campanha utilizavel agora (empresa, ativo=1 e dentro da janela de datas)
    const info = await campanhaAtivaInfo(portal.id);
    if (!info) {
      return res.status(404).json({ error: "Sem campanha ativa" });
    }
    const [[campanha]] = await db.execute(
      "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?",
      [info.id, portal.empresa_id]
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
        frequencia: info.frequencia,
        itens,
      },
    });
  } catch (err) {
    console.error("Erro ao obter campanha por portal:", err);
    res.status(500).json({ error: "Erro ao obter campanha" });
  }
};

// Dedupe em memoria (30 min): mesma sessao nao conta 2x a mesma view/clique (reload, toque duplo, bot simples).
const dedupe = criarDedupe();
exports._dedupe = dedupe; // so para testes

// A "sessao" e' um id aleatorio gerado pelo player (sessionStorage). Sem ele (cliente antigo) cai no IP.
function chaveSessao(req) {
  const s = req.body && typeof req.body.sessao === "string" ? req.body.sessao : "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : `ip:${req.ip}`;
}

// Soma 1 em campanha_metricas (dia de hoje) para (campanha, item); item 0 = total da campanha.
async function contar(campanhaId, empresaId, itemId, coluna) {
  const col = coluna === "cliques" ? "cliques" : "views";
  await db.execute(
    `INSERT INTO campanha_metricas (campanha_id, empresa_id, item_id, dia, ${col})
     VALUES (?, ?, ?, CURDATE(), 1)
     ON DUPLICATE KEY UPDATE ${col} = ${col} + 1`,
    [campanhaId, empresaId, itemId]
  );
}

/**
 * Registra uma visualizacao. Rota publica, so conta campanha utilizavel (ativa, com itens) do portal.
 * Corpo: { sessao, item_id? }  — sem item_id = a campanha foi aberta; com item_id = aquele slide foi exibido.
 * Repeticoes da mesma sessao em 30 min nao contam (resposta { deduplicado: true }).
 */
exports.registrarView = async (req, res) => {
  const { portalId } = req.params;
  try {
    const campanhaId = await campanhaAtivaDoPortal(portalId);
    if (!campanhaId) return res.json({ success: true, skipped: true });

    const [[portal]] = await db.execute("SELECT empresa_id FROM portais WHERE id = ?", [portalId]);
    if (!portal) return res.json({ success: true, skipped: true });

    const sessao = chaveSessao(req);
    const temItem = req.body && req.body.item_id !== undefined && req.body.item_id !== null;
    const itemId = temItem ? Number(req.body.item_id) : 0;

    if (temItem) {
      if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: "item_id inválido" });
      const [[item]] = await db.execute(
        "SELECT id FROM campanha_itens WHERE id = ? AND campanha_id = ? AND empresa_id = ?",
        [itemId, campanhaId, portal.empresa_id]
      );
      if (!item) return res.status(400).json({ error: "item_id inválido" });
      if (dedupe.jaVisto(`vi:${itemId}:${sessao}`)) return res.json({ success: true, deduplicado: true });
      await contar(campanhaId, portal.empresa_id, itemId, "views");
      return res.json({ success: true });
    }

    if (dedupe.jaVisto(`vc:${campanhaId}:${sessao}`)) return res.json({ success: true, deduplicado: true });
    await db.execute("UPDATE campanhas SET views = views + 1 WHERE id = ? AND empresa_id = ?", [campanhaId, portal.empresa_id]);
    await contar(campanhaId, portal.empresa_id, 0, "views");
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar view da campanha:", err);
    res.status(500).json({ error: "Erro ao registrar view" });
  }
};

/**
 * Registra um clique no botao "Saiba mais" de um item. Corpo: { item_id, sessao }.
 * So conta item da campanha utilizavel do portal que tenha link; 1 clique por sessao e item em 30 min.
 */
exports.registrarClique = async (req, res) => {
  const { portalId } = req.params;
  try {
    const itemId = Number(req.body && req.body.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: "item_id inválido" });

    const campanhaId = await campanhaAtivaDoPortal(portalId);
    if (!campanhaId) return res.json({ success: true, skipped: true });

    const [[portal]] = await db.execute("SELECT empresa_id FROM portais WHERE id = ?", [portalId]);
    if (!portal) return res.json({ success: true, skipped: true });

    const [[item]] = await db.execute(
      "SELECT id, link_destino FROM campanha_itens WHERE id = ? AND campanha_id = ? AND empresa_id = ?",
      [itemId, campanhaId, portal.empresa_id]
    );
    if (!item) return res.status(400).json({ error: "item_id inválido" });
    if (!item.link_destino) return res.json({ success: true, skipped: true });

    if (dedupe.jaVisto(`cl:${itemId}:${chaveSessao(req)}`)) return res.json({ success: true, deduplicado: true });
    await contar(campanhaId, portal.empresa_id, itemId, "cliques");
    await contar(campanhaId, portal.empresa_id, 0, "cliques");
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar clique da campanha:", err);
    res.status(500).json({ error: "Erro ao registrar clique" });
  }
};
