const axios = require("axios");
const db = require("../../db");
const { mascararNome } = require("./mascararDados");
const { sugerirMapeamento } = require("./importCadastros");

/**
 * Cliente da API do SGP. Config por empresa em empresa_configs (config_type='sgp'):
 *   { url, app, token, endpoint? }  — endpoint padrao: /api/ura/clientes/
 *
 * ATENCAO: o formato exato da resposta varia entre versoes do SGP. Este cliente aceita
 * a lista em `clientes`, `results`, `data` ou na raiz, e achata objetos aninhados
 * (endereco.cidade -> endereco_cidade) para o mapeamento automatico de colunas.
 */
const ENDPOINT_PADRAO = "/api/ura/clientes/";
const PAGINA = 200;
const MAX_PAGINAS = 100;
const TIMEOUT_MS = 20000;

async function carregarConfig(empresaId) {
  const [[row]] = await db.execute(
    "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'sgp'",
    [empresaId]
  );
  if (!row) return null;
  return typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
}

async function salvarConfig(empresaId, { url, app, token, endpoint }) {
  const atual = (await carregarConfig(empresaId)) || {};
  const nova = {
    url: normalizarUrl(url),
    app: String(app || "").trim(),
    // token em branco = mantem o ja salvo (a tela nunca recebe o token de volta)
    token: token ? String(token).trim() : atual.token || "",
    endpoint: String(endpoint || ENDPOINT_PADRAO).trim(),
  };
  await db.execute(
    `INSERT INTO empresa_configs (empresa_id, config_type, config_json) VALUES (?, 'sgp', ?)
     ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), atualizado_em = CURRENT_TIMESTAMP`,
    [empresaId, JSON.stringify(nova)]
  );
}

function normalizarUrl(url) {
  let u = String(url || "").trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/** Bloqueia destinos internos (SSRF): o admin do tenant informa a URL, o servidor faz a chamada. */
function urlPermitida(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "[::1]" || h === "::1") return false;
  if (/^127\./.test(h) || /^169\.254\./.test(h)) return false;
  return true;
}

/** Config sem o token, para devolver a tela. */
function publica(cfg) {
  if (!cfg) return { configurado: false, url: "", app: "", endpoint: ENDPOINT_PADRAO, token_definido: false };
  return { configurado: !!(cfg.url && cfg.app && cfg.token), url: cfg.url || "", app: cfg.app || "", endpoint: cfg.endpoint || ENDPOINT_PADRAO, token_definido: !!cfg.token };
}

// Achata { endereco: { cidade } } em { endereco_cidade } e mantem a chave curta (cidade) se nao colidir.
function achatar(obj, prefixo = "", saida = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const chave = prefixo ? `${prefixo}_${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      achatar(v, chave, saida);
    } else if (Array.isArray(v)) {
      // listas (contratos etc.) nao entram no cadastro
    } else {
      saida[chave] = v;
      if (prefixo && saida[k] === undefined) saida[k] = v;
    }
  }
  return saida;
}

function extrairLista(corpo) {
  if (Array.isArray(corpo)) return corpo;
  for (const k of ["clientes", "results", "data", "items"]) {
    if (corpo && Array.isArray(corpo[k])) return corpo[k];
  }
  return null;
}

/** Erro com mensagem segura para o usuario (nunca inclui app/token). */
class SgpError extends Error {}

async function buscarPagina(cfg, offset) {
  const caminho = cfg.endpoint && cfg.endpoint.startsWith("/") ? cfg.endpoint : `/${cfg.endpoint || ENDPOINT_PADRAO}`;
  let resp;
  try {
    resp = await axios.post(
      `${cfg.url}${caminho}`,
      { app: cfg.app, token: cfg.token, offset, limit: PAGINA },
      { timeout: TIMEOUT_MS, validateStatus: () => true, maxRedirects: 0 }
    );
  } catch (err) {
    const c = err && err.code;
    if (c === "ECONNABORTED" || c === "ETIMEDOUT") throw new SgpError("Tempo esgotado ao falar com o SGP");
    if (c === "ENOTFOUND" || c === "EAI_AGAIN") throw new SgpError("Endereço do SGP não encontrado (confira a URL)");
    if (c === "ECONNREFUSED" || c === "ECONNRESET") throw new SgpError("O SGP recusou a conexão (confira URL e porta)");
    if (/certificate|SSL|TLS/i.test(String(err && (err.code || err.message)))) throw new SgpError("Falha de certificado SSL no SGP");
    throw new SgpError("Não foi possível conectar ao SGP");
  }
  if (resp.status === 401 || resp.status === 403) throw new SgpError("SGP recusou as credenciais (app/token)");
  if (resp.status === 404) throw new SgpError("Endpoint não encontrado no SGP (HTTP 404) — ajuste o campo Endpoint");
  if (resp.status >= 300 && resp.status < 400) throw new SgpError("O SGP redirecionou a requisição — use a URL final (https) no cadastro");
  if (resp.status >= 400) throw new SgpError(`SGP respondeu HTTP ${resp.status}`);
  const lista = extrairLista(resp.data);
  if (!lista) {
    const dica = resp.data && typeof resp.data === "object" ? ` (chaves recebidas: ${Object.keys(resp.data).slice(0, 8).join(", ") || "nenhuma"})` : " (a resposta não é JSON)";
    throw new SgpError(`Resposta do SGP em formato inesperado${dica}`);
  }
  return { http: resp.status, lista };
}

/**
 * Diagnostico: busca 1 pagina e informa o que o SGP devolveu, sem expor dados.
 * Devolve nomes dos campos (achatados), mapeamento sugerido e se nome e CPF/CNPJ foram identificados.
 */
async function testar(cfg) {
  const { http, lista } = await buscarPagina(cfg, 0);
  const campos = [...new Set(lista.slice(0, 20).flatMap((c) => Object.keys(achatar(c))))];
  const mapeamento = sugerirMapeamento(campos);
  return {
    http,
    registros: lista.length,
    campos,
    mapeamento,
    identificou: { nome: !!mapeamento.nome, documento: !!(mapeamento.cpf || mapeamento.cnpj) },
  };
}

const soDig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
const ultimos = (v, n) => { const d = soDig(v); return d ? `${"*".repeat(Math.max(d.length - n, 0))}${d.slice(-n)}` : ""; };

/** Mascara um valor conforme o nome do campo (para a amostra exibida ao admin). */
function mascararValor(chave, valor) {
  if (valor == null || valor === "") return "";
  const k = String(chave).toLowerCase();
  const v = String(valor);
  if (/cpf|cnpj|documento|\brg\b|^rg|identidade/.test(k)) return ultimos(v, 2);
  if (/mail/.test(k)) { const [u, d] = v.split("@"); return d ? `${u.slice(0, 2)}***@${d}` : "***"; }
  if (/fone|tel|cel|whats/.test(k)) return ultimos(v, 4);
  if (/nasc/.test(k)) { const m = /(\d{4})/.exec(v); return m ? `**/**/${m[1]}` : "***"; }
  if (/nome|razao|cliente/.test(k)) return mascararNome(v);
  // so o ultimo trecho do nome achatado (endereco_uf nao e' logradouro)
  if (/^(cep|logradouro|endereco|rua|bairro|numero|complemento)$/.test(k.split("_").pop())) return `${v.slice(0, 3)}***`;
  return v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

/** Ate 3 registros da 1a pagina com dados pessoais mascarados. */
async function amostra(cfg) {
  const { lista } = await buscarPagina(cfg, 0);
  return lista.slice(0, 3).map((c) => {
    const plano = achatar(c);
    const out = {};
    for (const [k, v] of Object.entries(plano)) out[k] = mascararValor(k, v);
    return out;
  });
}

/** Busca todos os clientes (paginado) ja achatados. */
async function buscarTodos(cfg) {
  const todos = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { lista } = await buscarPagina(cfg, p * PAGINA);
    todos.push(...lista.map((c) => achatar(c)));
    if (lista.length < PAGINA) break;
  }
  return todos;
}

module.exports = { SgpError, carregarConfig, salvarConfig, publica, testar, amostra, mascararValor, buscarTodos, achatar, extrairLista, normalizarUrl, urlPermitida, ENDPOINT_PADRAO };
