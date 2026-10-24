// Helpers de teste: stub de require.cache (sem DB real) e req/res falsos.
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const abs = (p) => path.resolve(ROOT, p);

function stub(relPath, exports_) {
  const file = require.resolve(abs(relPath));
  const m = new Module(file);
  m.filename = file; m.loaded = true; m.exports = exports_;
  require.cache[file] = m;
  return file;
}

// Cria um db falso que registra todas as chamadas. handler(sql, params) pode
// devolver o resultado (ex.: [[row]]); default: [[]] (rows vazias).
function criarDb(handler) {
  const calls = [];
  const fn = async (sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params: params || [] });
    const r = handler ? await handler(s, params || []) : undefined;
    return r === undefined ? [[]] : r;
  };
  return { execute: fn, query: fn, calls };
}

// Carrega um modulo "limpo" com db (e outros) stubados.
function carregar(relPath, { db, extras = {} } = {}) {
  const alvo = require.resolve(abs(relPath));
  delete require.cache[alvo];
  if (db) stub('db.js', db);
  for (const [k, v] of Object.entries(extras)) stub(k, v);
  const mod = require(alvo);
  return mod;
}

function criarRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.header = res.setHeader; res.set = res.setHeader;
  res.attachment = () => res;
  res.type = () => res;
  return res;
}

function criarReq(over = {}) {
  return { headers: {}, query: {}, params: {}, body: {}, ...over };
}

module.exports = { stub, criarDb, carregar, criarRes, criarReq };
