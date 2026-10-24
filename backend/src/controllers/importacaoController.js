const {
  CAMPOS, MODELO_CSV, sugerirMapeamento, lerPlanilha, processarImportacao,
} = require("../utils/importCadastros");
const sgp = require("../utils/sgpClient");

function mapeamentoDoBody(raw) {
  let m = raw;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = null; } }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const permitidos = new Set(CAMPOS.map((c) => c.campo));
  const limpo = {};
  for (const [campo, cab] of Object.entries(m)) {
    if (permitidos.has(campo) && typeof cab === "string" && cab) limpo[campo] = cab;
  }
  return limpo;
}

const erroLeitura = (res, err) => res.status(400).json({ message: err.message || "Não foi possível ler o arquivo" });

// GET /api/clientes-import/campos
exports.campos = (req, res) => res.json(CAMPOS.map(({ campo, rotulo }) => ({ campo, rotulo })));

// GET /api/clientes-import/modelo.csv
exports.modelo = (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="modelo-clientes.csv"');
  res.send("﻿" + MODELO_CSV);
};

// POST /api/clientes-import/planilha/preview  (multipart: arquivo)
exports.previewPlanilha = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Envie um arquivo CSV ou XLSX" });
  try {
    const { cabecalhos, linhas } = await lerPlanilha(req.file.buffer, req.file.originalname);
    if (!cabecalhos.length) return res.status(400).json({ message: "Planilha vazia" });
    res.json({ cabecalhos, total: linhas.length, amostra: linhas.slice(0, 5), mapeamento: sugerirMapeamento(cabecalhos) });
  } catch (err) {
    erroLeitura(res, err);
  }
};

// POST /api/clientes-import/planilha/importar  (multipart: arquivo, mapeamento JSON, simular)
exports.importarPlanilha = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Envie um arquivo CSV ou XLSX" });
  const mapeamento = mapeamentoDoBody(req.body.mapeamento);
  if (!mapeamento || !mapeamento.nome || !(mapeamento.cpf || mapeamento.cnpj)) {
    return res.status(400).json({ message: "Mapeie ao menos Nome e CPF/CNPJ" });
  }
  let dados;
  try {
    dados = await lerPlanilha(req.file.buffer, req.file.originalname);
  } catch (err) {
    return erroLeitura(res, err);
  }
  try {
    const resumo = await processarImportacao(dados.linhas, mapeamento, req.empresa_id, {
      sistemaOrigem: "planilha", dryRun: req.body.simular === "true" || req.body.simular === true,
    });
    res.json({ success: true, simulacao: req.body.simular === "true", ...resumo });
  } catch (err) {
    console.error("Erro na importação de planilha:", err.message);
    res.status(500).json({ message: "Erro ao importar planilha" });
  }
};

// GET /api/clientes-import/sgp/config
exports.obterSgp = async (req, res) => {
  try {
    res.json(sgp.publica(await sgp.carregarConfig(req.empresa_id)));
  } catch (err) {
    console.error("Erro ao obter config SGP:", err.message);
    res.status(500).json({ message: "Erro ao obter configuração do SGP" });
  }
};

// PUT /api/clientes-import/sgp/config
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

async function configValida(req, res) {
  const cfg = await sgp.carregarConfig(req.empresa_id);
  if (!cfg || !cfg.url || !cfg.app || !cfg.token) {
    res.status(400).json({ message: "Configure a URL, o app e o token do SGP primeiro" });
    return null;
  }
  if (!sgp.urlPermitida(cfg.url)) {
    res.status(400).json({ message: "URL do SGP inválida" });
    return null;
  }
  return cfg;
}

// POST /api/clientes-import/sgp/testar
exports.testarSgp = async (req, res) => {
  try {
    const cfg = await configValida(req, res);
    if (!cfg) return;
    const r = await sgp.testar(cfg);
    res.json({ success: true, ...r });
  } catch (err) {
    res.status(502).json({ message: `Falha ao consultar o SGP: ${err.message}` });
  }
};

// POST /api/clientes-import/sgp/importar  { mapeamento?, simular? }
exports.importarSgp = async (req, res) => {
  try {
    const cfg = await configValida(req, res);
    if (!cfg) return;
    let linhas;
    try {
      linhas = await sgp.buscarTodos(cfg);
    } catch (err) {
      return res.status(502).json({ message: `Falha ao consultar o SGP: ${err.message}` });
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
