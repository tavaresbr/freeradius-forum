// Cliente unico da API da Anthropic (SDK oficial). Chave unica da PLATAFORMA (ANTHROPIC_API_KEY, so no servidor):
// o custo e' da plataforma, controlado pelo limite mensal do plano (services/iaUso). Sem a chave a IA nao existe.
const Anthropic = require("@anthropic-ai/sdk");

// Atendente (fala com o cliente) e copiloto (rascunho para a equipe) podem usar modelos diferentes.
const MODELO_ATENDENTE_PADRAO = "claude-opus-5-5";
const MODELO_COPILOTO_PADRAO = "claude-haiku-5-5";

const disponivel = () => !!String(process.env.ANTHROPIC_API_KEY || "").trim();
const modeloAtendente = () => String(process.env.ANTHROPIC_MODEL_ATENDENTE || "").trim() || MODELO_ATENDENTE_PADRAO;
const modeloCopiloto = () => String(process.env.ANTHROPIC_MODEL || "").trim() || MODELO_COPILOTO_PADRAO;

let cliente = null;
let chaveDoCliente = null;
/** Cliente do SDK (criado sob demanda; recriado se a chave mudar). Lanca 503 sem chave. */
function obterCliente() {
  const chave = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!chave) throw Object.assign(new Error("IA não configurada"), { status: 503 });
  if (!cliente || chaveDoCliente !== chave) {
    cliente = new Anthropic({ apiKey: chave, timeout: 30000, maxRetries: 2 });
    chaveDoCliente = chave;
  }
  return cliente;
}

/** Tokens de uma resposta (entrada inclui leitura/escrita de cache). */
function tokensDe(resposta) {
  const u = (resposta && resposta.usage) || {};
  return {
    entrada: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    saida: u.output_tokens || 0,
  };
}

/** Texto dos blocos `text` da resposta (ignora thinking/tool_use). */
function textoDe(resposta) {
  return ((resposta && resposta.content) || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

module.exports = { disponivel, modeloAtendente, modeloCopiloto, obterCliente, tokensDe, textoDe, MODELO_ATENDENTE_PADRAO, MODELO_COPILOTO_PADRAO };
