// Varios numeros de WhatsApp por empresa (migration 075). O numero PRINCIPAL e' a instancia de
// empresa_configs 'whatsapp' (numero_id 0); os adicionais ficam em whatsapp_numeros. Tudo por empresa_id.
const db = require("../../db");
const { tabelaInexistente } = require("./assinatura");

const NOME_MAX = 60;

/** Nome exibido do numero: texto simples, sem controle, 1-60 caracteres. Devolve null se invalido. */
function nomeValido(v) {
  const nome = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return nome && nome.length <= NOME_MAX ? nome : null;
}

/** Nome da instancia na Evolution para o numero adicional `id` da empresa. */
const nomeInstancia = (empresaId, id) => `empresa_${Number(empresaId)}_n${Number(id)}`;

/** Quantos numeros a empresa pode ter no total (principal incluso). null = ilimitado. */
function limiteTotal(maxWhatsappNumeros) {
  return maxWhatsappNumeros == null ? null : Math.max(1, Number(maxWhatsappNumeros) || 1);
}

/** Pode conectar mais um numero? `existentes` = numeros adicionais ja cadastrados (o principal conta 1 a parte). */
function podeAdicionar(maxWhatsappNumeros, existentes) {
  const limite = limiteTotal(maxWhatsappNumeros);
  if (limite == null) return { ok: true, limite: null, usados: 1 + existentes };
  return { ok: 1 + existentes < limite, limite, usados: 1 + existentes };
}

/** Numeros adicionais da empresa. Sem a migration devolve []. */
async function listar(empresaId) {
  try {
    const [rows] = await db.query("SELECT id, nome, instance_name, criado_em FROM whatsapp_numeros WHERE empresa_id = ? ORDER BY id", [empresaId]);
    return rows;
  } catch (err) {
    if (tabelaInexistente(err)) return [];
    throw err;
  }
}

/** Numero adicional `id` DA EMPRESA (ou null). `id` 0/invalido = principal = null. */
async function obter(empresaId, id) {
  const n = parseInt(id, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    const [[row]] = await db.query("SELECT id, nome, instance_name, criado_em FROM whatsapp_numeros WHERE id = ? AND empresa_id = ?", [n, empresaId]);
    return row || null;
  } catch (err) {
    if (tabelaInexistente(err)) return null;
    throw err;
  }
}

/** Numero adicional da empresa dono da instancia, ou null. */
async function porInstancia(empresaId, instancia) {
  if (typeof instancia !== "string" || !instancia) return null;
  try {
    const [[row]] = await db.query("SELECT id, nome, instance_name FROM whatsapp_numeros WHERE empresa_id = ? AND instance_name = ?", [empresaId, instancia]);
    return row || null;
  } catch (err) {
    if (tabelaInexistente(err)) return null;
    throw err;
  }
}

module.exports = { NOME_MAX, nomeValido, nomeInstancia, limiteTotal, podeAdicionar, listar, obter, porInstancia };
