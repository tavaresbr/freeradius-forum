// Busca de cliente pelos 10 ultimos digitos do telefone (DDD + numero, com ou sem DDI/9o digito).
// A migration 050 cria leads.telefone_fim10 (coluna gerada + indice); sem ela cai na expressao antiga,
// que funciona mas varre a tabela. O resultado da checagem fica em cache por alguns minutos.
const db = require("../../db");

const EXPR_ANTIGA = "RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', ''), 10)";
const TTL_MS = 5 * 60 * 1000;
let cache = { valor: null, ate: 0 };

/** Expressao SQL (coluna ou funcao) com os 10 ultimos digitos do telefone do lead. */
async function exprTelefoneFim10() {
  if (cache.valor && Date.now() < cache.ate) return cache.valor;
  let valor = EXPR_ANTIGA;
  try {
    const [[r]] = await db.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'telefone_fim10'"
    );
    if (r && Number(r.n) > 0) valor = "telefone_fim10";
  } catch (err) { /* sem acesso ao INFORMATION_SCHEMA: segue com a expressao antiga */ }
  cache = { valor, ate: Date.now() + TTL_MS };
  return valor;
}

const limparCache = () => { cache = { valor: null, ate: 0 }; };

module.exports = { exprTelefoneFim10, limparCache, EXPR_ANTIGA };
