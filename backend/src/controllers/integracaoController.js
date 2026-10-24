const { sugerirMapeamento, processarImportacao, CAMPOS } = require("../utils/importCadastros");
const sgp = require("../utils/sgpClient");

// Mensagens do sgpClient sao seguras (sem app/token); qualquer outro erro vira texto generico
const msgSegura = (err) => (err instanceof sgp.SgpError ? err.message : "Falha ao consultar o SGP");

function mapeamentoDoBody(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const permitidos = new Set(CAMPOS.map((c) => c.campo));
  const limpo = {};
  for (const [campo, cab] of Object.entries(raw)) {
    if (permitidos.has(campo) && typeof cab === "string" && cab) limpo[campo] = cab;
  }
  return limpo;
}

async function configValida(req, res) {
  const cfg = await sgp.carregarConfig(req.empresa_id);
  if (!cfg || !cfg.url || !cfg.app || !cfg.token) {
    res.status(400).json({ message: "Salve a URL, o app e o token do SGP primeiro" });
    return null;
  }
  if (!sgp.urlPermitida(cfg.url)) {
    res.status(400).json({ message: "URL do SGP inválida" });
    return null;
  }
  return cfg;
}

// GET /api/integracoes  — resumo das integracoes da empresa (token nunca sai)
exports.listar = async (req, res) => {
  try {
    const cfg = sgp.publica(await sgp.carregarConfig(req.empresa_id));
    res.json([{ chave: "sgp", nome: "SGP", configurado: cfg.configurado }]);
  } catch (err) {
    console.error("Erro ao listar integrações:", err.message);
    res.status(500).json({ message: "Erro ao listar integrações" });
  }
};

// GET /api/integracoes/sgp
exports.obterSgp = async (req, res) => {
  try {
    res.json(sgp.publica(await sgp.carregarConfig(req.empresa_id)));
  } catch (err) {
    console.error("Erro ao obter config SGP:", err.message);
    res.status(500).json({ message: "Erro ao obter configuração do SGP" });
  }
};

// PUT /api/integracoes/sgp
exports.salvarSgp = async (req, res) => {
  try {
    const { url, app, token, endpoint } = req.body || {};
    const urlNorm = sgp.normalizarUrl(url);
    if (!urlNorm || !sgp.urlPermitida(urlNorm)) return res.status(400).json({ message: "URL do SGP inválida" });
    if (!String(app || "").trim()) return res.status(400).json({ message: "Informe o app do SGP" });
    const atual = await sgp.carregarConfig(req.empresa_id);
    if (!token && !(atual && atual.token)) return res.status(400).json({ message: "Informe o token do SGP" });
    if (endpoint && !String(endpoint).startsWith("/")) return res.status(400).json({ message: "O endpoint deve começar com /" });
    await sgp.salvarConfig(req.empresa_id, { url: urlNorm, app, token, endpoint });
    res.json({ success: true, message: "Configuração do SGP salva" });
  } catch (err) {
    console.error("Erro ao salvar config SGP:", err.message);
    res.status(500).json({ message: "Erro ao salvar configuração do SGP" });
  }
};

// POST /api/integracoes/sgp/testar
exports.testarSgp = async (req, res) => {
  try {
    const cfg = await configValida(req, res);
    if (!cfg) return;
    res.json({ success: true, ...(await sgp.testar(cfg)) });
  } catch (err) {
    res.status(502).json({ message: msgSegura(err) });
  }
};

// POST /api/integracoes/sgp/amostra  — ate 3 registros mascarados; nada e gravado
exports.amostraSgp = async (req, res) => {
  try {
    const cfg = await configValida(req, res);
    if (!cfg) return;
    res.json({ success: true, registros: await sgp.amostra(cfg) });
  } catch (err) {
    res.status(502).json({ message: msgSegura(err) });
  }
};

// POST /api/integracoes/sgp/importar  { mapeamento?, simular? }
exports.importarSgp = async (req, res) => {
  try {
    const cfg = await configValida(req, res);
    if (!cfg) return;
    let linhas;
    try {
      linhas = await sgp.buscarTodos(cfg);
    } catch (err) {
      return res.status(502).json({ message: msgSegura(err) });
    }
    const cabecalhos = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
    const mapeamento = mapeamentoDoBody(req.body && req.body.mapeamento) || sugerirMapeamento(cabecalhos);
    if (!mapeamento.nome || !(mapeamento.cpf || mapeamento.cnpj)) {
      return res.status(422).json({ message: "Não foi possível identificar nome e CPF/CNPJ nos dados do SGP", campos: cabecalhos, mapeamento });
    }
    const simular = !!(req.body && req.body.simular);
    const resumo = await processarImportacao(linhas, mapeamento, req.empresa_id, { sistemaOrigem: "sgp", dryRun: simular });
    res.json({ success: true, simulacao: simular, mapeamento, ...resumo });
  } catch (err) {
    console.error("Erro na importação SGP:", err.message);
    res.status(500).json({ message: "Erro ao importar do SGP" });
  }
};
