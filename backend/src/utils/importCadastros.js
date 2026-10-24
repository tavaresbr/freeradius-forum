const db = require("../../db");
const { validarCPF } = require("./cpf");
const { normalizarDataNascimento } = require("./dataNascimento");

const MAX_LINHAS = 20000;
const LOTE = 500;

// Campos de destino aceitos na importacao, com apelidos para o mapeamento automatico
// (cabecalho normalizado: minusculo, sem acento, so letras e numeros).
const CAMPOS = [
  { campo: "nome", rotulo: "Nome", apelidos: ["nome", "nomecompleto", "cliente", "nomecliente"] },
  { campo: "cpf", rotulo: "CPF / CNPJ", apelidos: ["cpf", "cpfcnpj", "cnpjcpf", "documento", "cpfcliente"] },
  { campo: "cnpj", rotulo: "CNPJ", apelidos: ["cnpj"] },
  { campo: "email", rotulo: "E-mail", apelidos: ["email", "emails", "emailcliente"] },
  { campo: "telefone", rotulo: "Telefone", apelidos: ["telefone", "celular", "fone", "whatsapp", "telefonecelular", "telefone1"] },
  { campo: "data_nascimento", rotulo: "Data de nascimento", apelidos: ["datanascimento", "datadenascimento", "nascimento", "datanasc", "dtnascimento", "dtnasc"] },
  { campo: "tipo_pessoa", rotulo: "Tipo de pessoa (PF/PJ)", apelidos: ["tipopessoa", "tipo", "pessoa"] },
  { campo: "rg", rotulo: "RG", apelidos: ["rg", "identidade", "rgie"] },
  { campo: "razao_social", rotulo: "Razão social", apelidos: ["razaosocial"] },
  { campo: "cep", rotulo: "CEP", apelidos: ["cep"] },
  { campo: "logradouro", rotulo: "Logradouro", apelidos: ["logradouro", "endereco", "rua"] },
  { campo: "numero", rotulo: "Número", apelidos: ["numero", "num", "nro"] },
  { campo: "complemento", rotulo: "Complemento", apelidos: ["complemento", "compl"] },
  { campo: "bairro", rotulo: "Bairro", apelidos: ["bairro"] },
  { campo: "cidade", rotulo: "Cidade", apelidos: ["cidade", "municipio"] },
  { campo: "uf", rotulo: "UF", apelidos: ["uf", "estado"] },
  { campo: "id_externo", rotulo: "ID no sistema de origem", apelidos: ["id", "idcliente", "codigo", "codcliente", "idexterno"] },
  { campo: "observacoes", rotulo: "Observações", apelidos: ["observacoes", "observacao", "obs"] },
];

const chaveCabecalho = (s) =>
  String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Sugere { campo: cabecalho } casando os cabecalhos da planilha com os apelidos conhecidos. */
function sugerirMapeamento(cabecalhos) {
  const mapa = {};
  const usados = new Set();
  for (const { campo, apelidos } of CAMPOS) {
    const achado = cabecalhos.find((h) => !usados.has(h) && apelidos.includes(chaveCabecalho(h)));
    if (achado !== undefined) { mapa[campo] = achado; usados.add(achado); }
  }
  return mapa;
}

const soDigitos = (v) => String(v == null ? "" : v).replace(/\D/g, "");
const texto = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function formatarTelefone(v) {
  let d = soDigitos(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

function formatarCep(v) {
  const d = soDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
}

/** Aceita Date, serial do Excel, 'DD/MM/AAAA', 'AAAA-MM-DD' e ISO com hora. Devolve 'AAAA-MM-DD' ou null. */
function normalizarDataImport(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return normalizarDataNascimento(v.toISOString().slice(0, 10));
  }
  if (typeof v === "number") {
    if (v < 1 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return normalizarDataNascimento(d.toISOString().slice(0, 10));
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return normalizarDataNascimento(s.slice(0, 10));
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s);
  if (m) return normalizarDataNascimento(`${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`);
  return null;
}

/**
 * Converte uma linha crua em dados prontos para gravar.
 * @param {Object} linha - { cabecalho: valor }
 * @param {Object} mapeamento - { campo: cabecalho }
 * @returns {{dados?: Object, erro?: string, avisos: string[]}}
 */
function normalizarLinha(linha, mapeamento) {
  const avisos = [];
  const pega = (campo) => {
    const h = mapeamento[campo];
    return h === undefined || h === null || h === "" ? null : linha[h];
  };

  const nome = texto(pega("nome"), 255);
  if (!nome) return { erro: "Nome vazio", avisos };

  let cpf = null;
  let cnpj = null;
  const docCpf = soDigitos(pega("cpf"));
  const docCnpj = soDigitos(pega("cnpj"));
  if (docCpf.length === 14) cnpj = docCpf;
  else if (docCpf) {
    if (!validarCPF(docCpf)) return { erro: "CPF inválido", avisos };
    cpf = docCpf;
  }
  if (docCnpj) {
    if (docCnpj.length !== 14) return { erro: "CNPJ inválido", avisos };
    cnpj = docCnpj;
  }
  if (!cpf && !cnpj) return { erro: "Sem CPF/CNPJ", avisos };

  const tipoCru = String(pega("tipo_pessoa") || "").trim().toUpperCase();
  const tipo_pessoa = tipoCru.startsWith("J") ? "PJ" : tipoCru.startsWith("F") ? "PF" : (cnpj && !cpf ? "PJ" : "PF");

  let email = texto(pega("email"), 255);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { avisos.push("e-mail inválido ignorado"); email = null; }

  const telCru = pega("telefone");
  const telefone = formatarTelefone(telCru);
  if (telCru && !telefone) avisos.push("telefone inválido ignorado");

  const nascCru = pega("data_nascimento");
  const data_nascimento = normalizarDataImport(nascCru);
  if (nascCru && !data_nascimento) avisos.push("data de nascimento inválida ignorada");

  const ufCru = texto(pega("uf"), 2);
  const dados = {
    nome, cpf, cnpj, tipo_pessoa, email, telefone, data_nascimento,
    rg: texto(pega("rg"), 30),
    razao_social: texto(pega("razao_social"), 255),
    cep: formatarCep(pega("cep")),
    logradouro: texto(pega("logradouro"), 255),
    numero: texto(pega("numero"), 20),
    complemento: texto(pega("complemento"), 100),
    bairro: texto(pega("bairro"), 100),
    cidade: texto(pega("cidade"), 100),
    uf: ufCru && /^[A-Za-z]{2}$/.test(ufCru) ? ufCru.toUpperCase() : null,
    id_externo: texto(pega("id_externo"), 64),
    observacoes: texto(pega("observacoes"), 2000),
  };
  return { dados, avisos };
}

// Colunas gravadas (alem de empresa_id, sistema_origem, importado_em, origem, status, lgpd_aceite).
const COLUNAS_DADOS = [
  "nome", "email", "telefone", "cpf", "cnpj", "tipo_pessoa", "rg", "razao_social", "data_nascimento",
  "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "id_externo", "observacoes",
];
// Para leads existentes: so preenche o que esta vazio. cpf/cnpj/status/lgpd_* nunca mudam.
const COLUNAS_MESCLA = COLUNAS_DADOS.filter((c) => !["cpf", "cnpj", "tipo_pessoa"].includes(c));

const SQL_LIMPO = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(${col}, '.', ''), '-', ''), '/', ''), ' ', '')`;

/**
 * Importa linhas ja mapeadas para a tabela leads da empresa.
 * CPF/CNPJ novo => INSERT; existente => preenche so campos vazios (nunca sobrescreve,
 * nunca mexe em lgpd_aceite/lgpd_termo/status). Duplicado dentro do proprio arquivo e' ignorado.
 * @param {Object[]} linhas - { cabecalho: valor }
 * @param {Object} mapeamento - { campo: cabecalho }
 * @param {number} empresaId
 * @param {{sistemaOrigem?: string, dryRun?: boolean}} [opcoes]
 */
async function processarImportacao(linhas, mapeamento, empresaId, { sistemaOrigem = "planilha", dryRun = false } = {}) {
  const resumo = { total: linhas.length, criados: 0, atualizados: 0, ignorados: 0, erros: [] };
  if (!empresaId) throw new Error("empresaId obrigatorio");
  if (linhas.length > MAX_LINHAS) throw new Error(`Máximo de ${MAX_LINHAS} linhas por importação`);

  const [existentes] = await db.query(
    `SELECT id, ${SQL_LIMPO("cpf")} AS cpf_l, ${SQL_LIMPO("cnpj")} AS cnpj_l
     FROM leads WHERE empresa_id = ? AND (cpf IS NOT NULL OR cnpj IS NOT NULL)`,
    [empresaId]
  );
  const porDoc = new Map();
  for (const e of existentes) {
    if (e.cpf_l) porDoc.set(e.cpf_l, e.id);
    if (e.cnpj_l) porDoc.set(e.cnpj_l, e.id);
  }

  const vistos = new Set();
  const novos = [];
  const mesclas = [];

  linhas.forEach((linha, i) => {
    const numero = i + 2; // linha 1 = cabecalho
    const { dados, erro } = normalizarLinha(linha, mapeamento);
    if (erro) { resumo.erros.push({ linha: numero, motivo: erro }); return; }
    const chave = dados.cpf || dados.cnpj;
    if (vistos.has(chave)) { resumo.ignorados++; return; }
    vistos.add(chave);
    const id = porDoc.get(chave);
    if (id) mesclas.push({ id, dados });
    else novos.push(dados);
  });

  resumo.criados = novos.length;
  resumo.atualizados = mesclas.length;
  if (dryRun) return resumo;

  const agora = new Date();
  for (let i = 0; i < novos.length; i += LOTE) {
    const valores = novos.slice(i, i + LOTE).map((d) => [
      empresaId, ...COLUNAS_DADOS.map((c) => d[c]), sistemaOrigem, agora, "importacao", "novo", 0,
    ]);
    await db.query(
      `INSERT INTO leads (empresa_id, ${COLUNAS_DADOS.join(", ")}, sistema_origem, importado_em, origem, status, lgpd_aceite) VALUES ?`,
      [valores]
    );
  }

  for (const { id, dados } of mesclas) {
    // DATE nao pode ser comparada com '' (erro em modo estrito): so COALESCE.
    const sets = COLUNAS_MESCLA.map((c) => (c === "data_nascimento" ? `${c} = COALESCE(${c}, ?)` : `${c} = COALESCE(NULLIF(${c}, ''), ?)`));
    await db.execute(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = ? AND empresa_id = ?`,
      [...COLUNAS_MESCLA.map((c) => dados[c]), id, empresaId]
    );
  }
  return resumo;
}

/** Le CSV (UTF-8 ou Latin-1, delimitador , ; ou tab, aspas RFC 4180). */
function parseCsv(buffer) {
  let s = buffer.toString("utf8");
  if (s.includes("�")) s = buffer.toString("latin1");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const primeira = s.split(/\r?\n/, 1)[0] || "";
  const cont = (ch) => primeira.split(ch).length - 1;
  const delim = [";", "\t", ","].reduce((a, b) => (cont(b) > cont(a) ? b : a), ",");

  const linhas = [];
  let campo = "", reg = [], aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === delim) { reg.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      reg.push(campo); campo = "";
      if (reg.some((x) => x !== "")) linhas.push(reg);
      reg = [];
    } else campo += c;
  }
  reg.push(campo);
  if (reg.some((x) => x !== "")) linhas.push(reg);
  return matrizParaObjetos(linhas);
}

function matrizParaObjetos(matriz) {
  if (!matriz.length) return { cabecalhos: [], linhas: [] };
  const vistos = {};
  const cabecalhos = matriz[0].map((h, i) => {
    let nome = String(h == null ? "" : h).trim() || `Coluna ${i + 1}`;
    if (vistos[nome]) nome = `${nome} (${++vistos[nome]})`;
    else vistos[nome] = 1;
    return nome;
  });
  const linhas = matriz.slice(1).map((r) => {
    const o = {};
    cabecalhos.forEach((h, i) => { o[h] = r[i] === undefined ? "" : r[i]; });
    return o;
  });
  return { cabecalhos, linhas };
}

/** Le a primeira planilha de um .xlsx. */
async function parseXlsx(buffer) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { cabecalhos: [], linhas: [] };
  const valorCelula = (v) => {
    if (v == null) return "";
    if (v instanceof Date) return v;
    if (typeof v === "object") {
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
      if (v.result !== undefined) return valorCelula(v.result);
      if (v.text !== undefined) return String(v.text);
      return "";
    }
    return v;
  };
  const matriz = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const r = [];
    for (let c = 1; c <= ws.columnCount; c++) r.push(valorCelula(row.getCell(c).value));
    matriz.push(r);
  });
  return matrizParaObjetos(matriz);
}

async function lerPlanilha(buffer, nomeArquivo) {
  const ext = String(nomeArquivo || "").toLowerCase().split(".").pop();
  const r = ext === "xlsx" ? await parseXlsx(buffer) : parseCsv(buffer);
  if (r.linhas.length > MAX_LINHAS) throw new Error(`Máximo de ${MAX_LINHAS} linhas por importação`);
  return r;
}

const MODELO_CSV =
  "nome;cpf;data_nascimento;telefone;email;rg;cep;logradouro;numero;complemento;bairro;cidade;uf;id_externo;observacoes\r\n" +
  "Maria da Silva;529.982.247-25;17/05/1990;(93) 99999-0000;maria@exemplo.com;1234567;68000-000;Rua das Flores;100;Casa;Centro;Santarém;PA;1001;Cliente antigo\r\n";

module.exports = {
  CAMPOS, MAX_LINHAS, MODELO_CSV,
  sugerirMapeamento, normalizarLinha, normalizarDataImport, formatarTelefone, formatarCep,
  processarImportacao, parseCsv, lerPlanilha,
};
