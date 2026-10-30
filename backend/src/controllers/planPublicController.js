const db = require("../../db");

// Planos com nomes reservados para uso interno (lead capture / LGPD).
// Estes nao devem aparecer no portal de venda para o cliente final.
const NOMES_INTERNOS = ['lead', 'lgpd'];

// Lista planos públicos - filtra por mikrotik_id para resolver a empresa
exports.listarPlanosPublicos = async (req, res) => {
  try {
    const { mikrotik_id, empresa_id } = req.query;

    let query = "SELECT * FROM planos WHERE ativo = 1 AND LOWER(nome) NOT IN (?, ?)";
    const params = [...NOMES_INTERNOS];

    if (mikrotik_id) {
      // Filtra planos do MikroTik específico (resolve empresa automaticamente)
      query += " AND mikrotik_id = ?";
      params.push(mikrotik_id);
    } else if (empresa_id) {
      // Filtra por empresa diretamente
      query += " AND empresa_id = ?";
      params.push(empresa_id);
    }

    query += " ORDER BY valor ASC";

    const [planos] = await db.query(query, params);
    res.json(planos);
  } catch (err) {
    console.error("Erro ao buscar planos públicos:", err);
    res.status(500).json({ message: "Erro ao buscar planos" });
  }
};

exports.buscarPlanoPublicoPorId = async (req, res) => {
  const { id } = req.params;
  // portal_id explicito (vindo do redirect entre portais).
  // Quando o cliente vem do portal Login -> Planos via "Clique aqui",
  // o mikrotiks.portal_id ainda aponta pro portal Login (errado).
  // O frontend passa o portal_id real do destino aqui.
  const portalIdQuery = req.query.portal_id ? parseInt(req.query.portal_id, 10) : null;
  try {
    // JOIN com portal: prioriza portal_id explicito da query.
    // Fallback: mikrotiks.portal_id (caminho legado, sem redirect).
    const sql = portalIdQuery
      ? `SELECT p.*, po.configuracoes AS _portal_config
           FROM planos p
           LEFT JOIN portais po ON po.id = ? AND po.empresa_id = p.empresa_id
          WHERE p.id = ? AND p.ativo = 1 AND LOWER(p.nome) NOT IN (?, ?)`
      : `SELECT p.*, po.configuracoes AS _portal_config
           FROM planos p
           LEFT JOIN mikrotiks m ON m.id = p.mikrotik_id
           LEFT JOIN portais po ON po.id = m.portal_id
          WHERE p.id = ? AND p.ativo = 1 AND LOWER(p.nome) NOT IN (?, ?)`;

    const params = portalIdQuery
      ? [portalIdQuery, id, ...NOMES_INTERNOS]
      : [id, ...NOMES_INTERNOS];

    const [planos] = await db.query(sql, params);
    if (!planos.length) {
      return res.status(404).json({ message: "Plano não encontrado." });
    }

    const plano = planos[0];
    let portalConfig = {};
    try {
      if (plano._portal_config) {
        portalConfig = typeof plano._portal_config === "string"
          ? JSON.parse(plano._portal_config)
          : plano._portal_config;
      }
    } catch (e) { /* JSON invalido -> usa defaults */ }

    // Defaults: ambos ativos (compatibilidade com portais sem a config salva)
    plano.pagamento_pix_ativo = portalConfig.pagamento_pix_ativo !== false;
    plano.pagamento_cartao_ativo = portalConfig.pagamento_cartao_ativo !== false;

    // PIX trial (acesso free): OPT-IN por default (disabled ate o admin ligar)
    plano.pix_trial_enabled = portalConfig.pix_trial_enabled === true;
    plano.pix_trial_duracao_minutos = parseInt(portalConfig.pix_trial_duracao_minutos || 5, 10);

    // Quem processa o cartao: o formulario do Asaas pede CEP/numero e dispensa o fingerprint do Mercado Pago.
    try {
      const asaas = require("../utils/asaasClient");
      plano.cartao_provider = asaas.cartaoAtivo(await asaas.carregarConfig(plano.empresa_id)) ? "asaas" : "mercadopago";
    } catch (e) {
      plano.cartao_provider = "mercadopago";
    }

    delete plano._portal_config;
    res.json(plano);
  } catch (err) {
    console.error("Erro ao buscar plano público:", err);
    res.status(500).json({ message: "Erro ao buscar plano" });
  }
};
