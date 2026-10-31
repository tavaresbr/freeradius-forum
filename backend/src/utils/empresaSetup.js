/**
 * empresaSetup — setup padrao de uma empresa nova.
 *
 * Os 6 portais padrao (lgpd, planos, lead, lead_passivo, login, voucher) TEM que existir
 * em toda empresa: os fluxos publicos resolvem portal por tipo
 * (SELECT ... WHERE tipo = ? AND empresa_id = ?) e falham em silencio sem eles
 * (aceite LGPD sem prova, lead sem portal_id, WhatsApp nunca dispara).
 *
 * Este helper e' a UNICA fonte desses INSERTs — usado por:
 *   - empresaController.criarEmpresa (painel super admin)
 *   - registroController.registrarEmpresa (registro publico /api/registro)
 * Nao duplicar o INSERT em outros lugares.
 */
const { DEFAULT_WHATSAPP_TEMPLATE, DEFAULT_PORTAL_PLANOS_CONFIG } = require("../constants/whatsappDefaults");

/**
 * Cria os 6 portais padrao da empresa.
 * O portal 'planos' ja vem com configuracoes padrao (PIX + Cartao ativos +
 * trial de 5min habilitado). Todos vem com template WhatsApp preenchido.
 *
 * @param {Object} executor - pool `db` ou uma connection de transacao (ambos tem .execute)
 * @param {number} empresaId
 */
async function criarPortaisPadrao(executor, empresaId) {
  const planosConfigJson = JSON.stringify(DEFAULT_PORTAL_PLANOS_CONFIG);
  await executor.execute(
    `INSERT INTO portais (empresa_id, nome, slug, tipo, url_redirect, ativo, whatsapp_template, configuracoes) VALUES
     (?, 'LGPD - Coleta de Dados', 'lgpd', 'lgpd', '/cadastro', 1, ?, NULL),
     (?, 'Planos - Pagamento', 'planos', 'planos', '/planos-cliente', 1, ?, ?),
     (?, 'Cadastro de LEAD', 'lead', 'lead', '/lead', 1, ?, NULL),
     (?, 'Cadastro de LEAD (Sem Internet)', 'lead-passivo', 'lead_passivo', '/lead-passivo', 1, ?, NULL),
     (?, 'Acesso Wi-Fi', 'login', 'login', '/login-hotspot', 1, ?, NULL),
     (?, 'Acesso por Voucher', 'voucher', 'voucher', '/voucher', 1, ?, NULL)`,
    [
      empresaId, DEFAULT_WHATSAPP_TEMPLATE,
      empresaId, DEFAULT_WHATSAPP_TEMPLATE, planosConfigJson,
      empresaId, DEFAULT_WHATSAPP_TEMPLATE,
      empresaId, DEFAULT_WHATSAPP_TEMPLATE,
      empresaId, DEFAULT_WHATSAPP_TEMPLATE,
      empresaId, DEFAULT_WHATSAPP_TEMPLATE,
    ]
  );
}

// Planos gratis que os portais LGPD e Lead resolvem por NOME (lgpdController / leadController).
// Sem eles o portal responde 404 e as telas Portais/Planos mostram o aviso "Plano nao encontrado".
const VELOCIDADE_DOWN = 20; // Mbps
const VELOCIDADE_UP = 10; // Mbps
const PLANOS_PADRAO = [
  { nome: "LGPD", descricao: "Acesso gratuito do portal LGPD", duracao_minutos: 60 },
  { nome: "Lead", descricao: "Acesso gratuito do portal de Leads", duracao_minutos: 60 },
];

/**
 * Cria os planos gratis padrao (LGPD e Lead) da empresa, se ainda nao existirem.
 * Nascem com mikrotik_id NULL (empresa nova nao tem equipamento); o primeiro
 * equipamento cadastrado os vincula (mikrotikRoutes.js).
 *
 * @param {Object} executor - pool `db` ou uma connection de transacao
 * @param {number} empresaId
 * @param {number|null} [mikrotikId] - equipamento ja existente (backfill)
 */
async function criarPlanosPadrao(executor, empresaId, mikrotikId = null) {
  for (const p of PLANOS_PADRAO) {
    await executor.execute(
      `INSERT INTO planos (empresa_id, nome, descricao, valor, duracao_minutos,
                           velocidade_down, velocidade_up, mikrotik_id, shared_users, ativo)
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, 1, 1 FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM planos WHERE empresa_id = ? AND LOWER(nome) = LOWER(?))`,
      [empresaId, p.nome, p.descricao, p.duracao_minutos, VELOCIDADE_DOWN, VELOCIDADE_UP, mikrotikId, empresaId, p.nome]
    );
  }
}

// Plano gratis que TODO equipamento novo ja recebe (alem de LGPD/Lead, que o 1o equipamento assume).
// Nao e' LGPD nem Lead: os portais dessas duas pontas resolvem o plano pelo NOME e nao sao afetados.
const PLANO_EQUIPAMENTO_PADRAO = { nome: "Plano 60 minutos", duracao_minutos: 60 };

/**
 * Cria o "Plano 60 minutos" gratis (60 min, 20M/10M) vinculado a UM equipamento, se ele ainda nao
 * tiver um plano com esse nome. Idempotente.
 *
 * @param {Object} executor - pool `db` ou uma connection
 * @param {number} empresaId
 * @param {number} mikrotikId
 * @param {string} [nomeEquipamento]
 */
async function criarPlanoPadraoEquipamento(executor, empresaId, mikrotikId, nomeEquipamento = "") {
  const p = PLANO_EQUIPAMENTO_PADRAO;
  const descricao = nomeEquipamento ? `${p.nome} - ${nomeEquipamento}` : p.nome;
  await executor.execute(
    `INSERT INTO planos (empresa_id, nome, descricao, valor, duracao_minutos,
                         velocidade_down, velocidade_up, mikrotik_id, shared_users, ativo)
     SELECT ?, ?, ?, 0, ?, ?, ?, ?, 1, 1 FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM planos WHERE empresa_id = ? AND mikrotik_id = ? AND LOWER(nome) = LOWER(?))`,
    [empresaId, p.nome, descricao, p.duracao_minutos, VELOCIDADE_DOWN, VELOCIDADE_UP, mikrotikId, empresaId, mikrotikId, p.nome]
  );
}

module.exports = { criarPortaisPadrao, criarPlanosPadrao, criarPlanoPadraoEquipamento, PLANOS_PADRAO, PLANO_EQUIPAMENTO_PADRAO };
