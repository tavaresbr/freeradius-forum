const axios = require("axios");
const dns = require("dns").promises;
const net = require("net");
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
const PAGINA = 100; // o SGP recusa limit > 100 (HTTP 400)
const MAX_PAGINAS = 500; // 50 mil clientes (paginas de 100)
const TIMEOUT_MS = 20000;

async function carregarConfig(empresaId) {
  const [[row]] = await db.execute(
    "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'sgp'",
    [empresaId]
  );
  if (!row) return null;
  return typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
}

const HORAS_PADRAO = 24;
const horasValidas = (h) => { const n = Math.round(Number(h)); return n >= 1 && n <= 168 ? n : HORAS_PADRAO; };

async function salvarConfig(empresaId, { url, app, token, endpoint, sync_auto, sync_horas }) {
  const atual = (await carregarConfig(empresaId)) || {};
  const nova = {
    url: normalizarUrl(url),
    app: String(app || "").trim(),
    // token em branco = mantem o ja salvo (a tela nunca recebe o token de volta)
    token: token ? String(token).trim() : atual.token || "",
    endpoint: String(endpoint || ENDPOINT_PADRAO).trim(),
    // sync automatica: so muda se o body trouxer o campo (clientes antigos da API nao o enviam)
    sync_auto: sync_auto === undefined ? !!atual.sync_auto : !!sync_auto,
    sync_horas: sync_horas === undefined ? horasValidas(atual.sync_horas) : horasValidas(sync_horas),
    ultima_sync: atual.ultima_sync || null,
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

/** IP (v4 ou v6, texto) em faixa interna: loopback, privada, CGNAT/VPN, link-local, multicast, reservada. */
function ipInterno(ip) {
  let h = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapeado) h = mapeado[1];
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (h.includes(":")) {
    return h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h) || /^::ffff:/.test(h) || /^64:ff9b:/.test(h);
  }
  return false;
}

/** Bloqueia destinos internos (SSRF): o admin do tenant informa a URL, o servidor faz a chamada. */
function urlPermitida(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (ipInterno(h)) return false;
  // formas numericas exoticas (0x7f.1, 2130706433) que o resolvedor converte em IP
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(h) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return true;
}

/** Resolve o nome e recusa se QUALQUER endereco for interno (anti DNS que aponta para a rede local). */
async function verificarDns(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return !ipInterno(host);
  try {
    const enderecos = await dns.lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipInterno(e.address));
  } catch {
    return false;
  }
}

/** Grava o resultado da ultima sincronizacao automatica (sem tocar no resto da config). */
async function registrarSync(empresaId, info) {
  const atual = await carregarConfig(empresaId);
  if (!atual) return;
  await db.execute(
    "UPDATE empresa_configs SET config_json = ? WHERE empresa_id = ? AND config_type = 'sgp'",
    [JSON.stringify({ ...atual, ultima_sync: info }), empresaId]
  );
}

/** Config sem o token, para devolver a tela. */
function publica(cfg) {
  if (!cfg) return { configurado: false, url: "", app: "", endpoint: ENDPOINT_PADRAO, token_definido: false, sync_auto: false, sync_horas: HORAS_PADRAO, ultima_sync: null };
  return {
    configurado: !!(cfg.url && cfg.app && cfg.token), url: cfg.url || "", app: cfg.app || "", endpoint: cfg.endpoint || ENDPOINT_PADRAO, token_definido: !!cfg.token,
    sync_auto: !!cfg.sync_auto, sync_horas: horasValidas(cfg.sync_horas), ultima_sync: cfg.ultima_sync || null,
  };
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

async function buscarPagina(cfg, offset, limite = PAGINA) {
  const caminho = cfg.endpoint && cfg.endpoint.startsWith("/") ? cfg.endpoint : `/${cfg.endpoint || ENDPOINT_PADRAO}`;
  if (!module.exports.urlPermitida(cfg.url) || !(await module.exports.verificarDns(cfg.url))) {
    throw new SgpError("URL do SGP aponta para um endereço não permitido");
  }
  let resp;
  try {
    resp = await axios.post(
      `${cfg.url}${caminho}`,
      { app: cfg.app, token: cfg.token, offset, limit: limite },
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
  if (resp.status >= 400) {
    throw new SgpError(`SGP respondeu HTTP ${resp.status}`);
  }
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

const TAM_AMOSTRA = 10;

/** Ate 10 registros (consulta so 10 ao SGP, mais rapido que uma pagina inteira) com dados pessoais mascarados. */
async function amostra(cfg) {
  const { lista } = await buscarPagina(cfg, 0, TAM_AMOSTRA);
  return lista.slice(0, TAM_AMOSTRA).map((c) => {
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

module.exports = { SgpError, carregarConfig, salvarConfig, registrarSync, horasValidas, publica, testar, amostra, mascararValor, buscarTodos, achatar, extrairLista, normalizarUrl, urlPermitida, verificarDns, ipInterno, ENDPOINT_PADRAO };
