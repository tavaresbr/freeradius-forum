const {
  CAMPOS, MODELO_CSV, sugerirMapeamento, lerPlanilha, processarImportacao,
} = require("../utils/importCadastros");

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

const { importarContatos } = require("../utils/whatsappContatos");

// POST /api/clientes-import/whatsapp/importar  ({ simular })
exports.importarWhatsapp = async (req, res) => {
  const simular = req.body?.simular === true || req.body?.simular === "true";
  try {
    const resumo = await importarContatos(req.empresa_id, { dryRun: simular });
    res.json({ success: true, simulacao: simular, ...resumo });
  } catch (err) {
    console.error("Erro ao importar contatos do WhatsApp:", err?.response?.data || err.message);
    res.status(502).json({ message: "Não foi possível ler os contatos do WhatsApp. Confira se a instância está conectada." });
  }
};

const { gravarContatos } = require("../utils/whatsappContatos");
const { lerContatosGoogle } = require("../utils/googleContatos");

// POST /api/clientes-import/{google,outlook}/importar  (multipart: arquivo CSV/VCF exportado, simular)
const importarContatosArquivo = (origem, nomeOrigem) => async (req, res) => {
  if (!req.file) return res.status(400).json({ message: `Envie o arquivo exportado do ${nomeOrigem} (CSV ou vCard)` });
  const simular = req.body?.simular === true || req.body?.simular === "true";
  let lido;
  try {
    lido = lerContatosGoogle(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ message: err.message || "Não foi possível ler o arquivo" });
  }
  try {
    const resumo = await gravarContatos(req.empresa_id, lido.contatos, origem, { dryRun: simular, invalidos: lido.invalidos });
    res.json({ success: true, simulacao: simular, ...resumo });
  } catch (err) {
    console.error(`Erro ao importar contatos (${origem}):`, err.message);
    res.status(500).json({ message: "Erro ao importar contatos" });
  }
};
exports.importarGoogle = importarContatosArquivo("google", "Google Contatos");
exports.importarOutlook = importarContatosArquivo("outlook", "Outlook");
