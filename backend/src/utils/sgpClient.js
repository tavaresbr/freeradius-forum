const axios = require("axios");
const db = require("../../db");

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

async function buscarPagina(cfg, offset) {
  const url = `${cfg.url}${cfg.endpoint && cfg.endpoint.startsWith("/") ? cfg.endpoint : `/${cfg.endpoint || ENDPOINT_PADRAO}`}`;
  const resp = await axios.post(
    url,
    { app: cfg.app, token: cfg.token, offset, limit: PAGINA },
    { timeout: TIMEOUT_MS, validateStatus: () => true }
  );
  if (resp.status === 401 || resp.status === 403) throw new Error("SGP recusou as credenciais (app/token)");
  if (resp.status >= 400) throw new Error(`SGP respondeu HTTP ${resp.status}`);
  const lista = extrairLista(resp.data);
  if (!lista) throw new Error("Resposta do SGP em formato inesperado (lista de clientes não encontrada)");
  return lista;
}

/** Testa credenciais buscando 1 pagina; devolve quantos registros vieram e as chaves da 1a linha. */
async function testar(cfg) {
  const lista = await buscarPagina(cfg, 0);
  return { amostra: lista.length, campos: lista[0] ? Object.keys(achatar(lista[0])) : [] };
}

/** Busca todos os clientes (paginado) ja achatados. */
async function buscarTodos(cfg) {
  const todos = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const lista = await buscarPagina(cfg, p * PAGINA);
    todos.push(...lista.map((c) => achatar(c)));
    if (lista.length < PAGINA) break;
  }
  return todos;
}

module.exports = { carregarConfig, salvarConfig, publica, testar, buscarTodos, achatar, extrairLista, normalizarUrl, urlPermitida, ENDPOINT_PADRAO };
