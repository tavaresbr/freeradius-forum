/**
 * voucher — geracao e validacao de codigos de acesso (vouchers).
 * Alfabeto sem simbolos ambiguos (0/O, 1/I/L): o codigo e' impresso e digitado a mao.
 */
const crypto = require("crypto");

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 simbolos
const TAMANHO_PADRAO = 8;
const MAX_LOTE = 500;

function gerarCodigo(tamanho = TAMANHO_PADRAO) {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}

/** Maiusculas, sem espacos/hifens. Nao-string => "". */
function normalizarCodigo(v) {
  if (typeof v !== "string") return "";
  return v.toUpperCase().replace(/[\s-]/g, "");
}

function codigoPersonalizadoValido(c) {
  return /^[A-Z0-9]{4,32}$/.test(c);
}

function quantidadeValida(q) {
  const n = Number(q);
  return Number.isInteger(n) && n >= 1 && n <= MAX_LOTE ? n : null;
}

/** AAAA-MM-DD valida e nao passada; null/"" => null (sem validade). Retorna undefined se invalida. */
function validarValidade(v, hoje = new Date()) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return undefined;
  if (v < hoje.toISOString().slice(0, 10)) return undefined;
  return v;
}

function celulaCsv(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injecao de formula no Excel
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { gerarCodigo, normalizarCodigo, codigoPersonalizadoValido, quantidadeValida, validarValidade, celulaCsv, MAX_LOTE };
