// Cupom de desconto. TODO o calculo e' feito aqui, no servidor: o navegador so manda o codigo.
// Valores em centavos (planos.valor / pagamentos.valor). Nunca devolve o motivo exato da recusa
// (codigo inexistente, vencido, esgotado e de outro plano respondem igual: sem enumerar cupons).
const db = require("../../db");
const { temColuna } = require("./schemaCache");

const VALOR_MINIMO = 100; // R$ 1,00: o plano nunca fica de graca nem abaixo disso por cupom
const MSG_INVALIDO = "Cupom inválido ou indisponível.";
const CODIGO_OK = /^[A-Z0-9]{3,32}$/;

const normalizarCodigo = (c) => String(c ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** Valida/normaliza o corpo do admin. Lanca Error (status 400). */
function validarCupomAdmin(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const codigo = normalizarCodigo(b.codigo);
  if (!CODIGO_OK.test(codigo)) throw erro("Código: 3 a 32 letras ou números, sem espaços");
  const tipo = b.tipo;
  if (tipo !== "percentual" && tipo !== "valor") throw erro("Tipo de desconto inválido");
  const valor = Number(b.valor);
  if (!Number.isInteger(valor) || valor < 1) throw erro("Informe o valor do desconto");
  if (tipo === "percentual" && valor > 99) throw erro("O desconto percentual vai de 1% a 99%");
  if (tipo === "valor" && valor > 1000000) throw erro("Valor do desconto muito alto");
  let planoId = null;
  if (b.plano_id !== undefined && b.plano_id !== null && b.plano_id !== "") {
    planoId = Number(b.plano_id);
    if (!Number.isInteger(planoId) || planoId < 1) throw erro("Plano inválido");
  }
  let validoAte = null;
  if (b.valido_ate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.valido_ate)) || Number.isNaN(Date.parse(b.valido_ate))) throw erro("Data de validade inválida");
    validoAte = String(b.valido_ate);
  }
  let maxUsos = null;
  if (b.max_usos !== undefined && b.max_usos !== null && b.max_usos !== "") {
    maxUsos = Number(b.max_usos);
    if (!Number.isInteger(maxUsos) || maxUsos < 1 || maxUsos > 1000000) throw erro("Limite de usos inválido");
  }
  return { codigo, tipo, valor, plano_id: planoId, valido_ate: validoAte, max_usos: maxUsos, ativo: b.ativo === false || b.ativo === 0 ? 0 : 1 };
}

/** Desconto em centavos e valor final (minimo R$ 1,00). Plano abaixo do minimo nao recebe cupom (desconto 0). */
function calcularDesconto(valorCentavos, cupom) {
  const valor = Number(valorCentavos);
  if (!Number.isFinite(valor) || valor <= VALOR_MINIMO) return { desconto: 0, valor_final: Math.max(0, valor || 0) };
  const bruto = cupom.tipo === "percentual" ? Math.floor((valor * Number(cupom.valor)) / 100) : Number(cupom.valor);
  const final = Math.max(VALOR_MINIMO, valor - Math.max(0, bruto));
  return { desconto: valor - final, valor_final: final };
}

/**
 * Resolve o cupom de um plano. Devolve { ok:false } (sem motivo) ou
 * { ok:true, cupom, valor_original, desconto, valor_final }.
 * Regras: da mesma empresa do plano, ativo, no prazo, com usos sobrando, do plano (ou de todos) e,
 * com CPF, nunca reusado pelo mesmo CPF (uma compra aprovada com o cupom ja o consumiu).
 */
async function resolverCupom({ empresaId, plano, codigo, cpf }) {
  const nada = { ok: false };
  try {
    const cod = normalizarCodigo(codigo);
    if (!CODIGO_OK.test(cod) || !plano || Number(plano.empresa_id) !== Number(empresaId)) return nada;
    if (!(await temColuna("pagamentos", "cupom_id"))) return nada; // migration 060 ainda nao rodou
    const [[cupom]] = await db.query(
      `SELECT id, empresa_id, codigo, tipo, valor, plano_id, max_usos, usos FROM cupons
        WHERE empresa_id = ? AND codigo = ? AND ativo = 1 AND (valido_ate IS NULL OR valido_ate >= CURDATE())`,
      [empresaId, cod]
    );
    if (!cupom) return nada;
    if (cupom.plano_id && Number(cupom.plano_id) !== Number(plano.id)) return nada;
    if (cupom.max_usos != null && Number(cupom.usos) >= Number(cupom.max_usos)) return nada;
    const cpfLimpo = String(cpf || "").replace(/\D/g, "");
    if (cpfLimpo.length === 11) {
      const [[jaUsou]] = await db.query(
        `SELECT id FROM pagamentos WHERE empresa_id = ? AND cupom_id = ? AND status IN ('approved','expirado')
            AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ? LIMIT 1`,
        [empresaId, cupom.id, cpfLimpo]
      );
      if (jaUsou) return nada;
    }
    const { desconto, valor_final } = calcularDesconto(plano.valor, cupom);
    if (desconto <= 0) return nada;
    return { ok: true, cupom, valor_original: Number(plano.valor), desconto, valor_final };
  } catch (err) {
    console.warn("[cupom] resolverCupom falhou:", err.message);
    return nada;
  }
}

/**
 * Conta o uso do cupom quando o pagamento e' aprovado/liberado (idempotente por pagamento: UNIQUE em
 * cupom_usos.pagamento_id). Nunca lanca e nao faz nada se o pagamento nao tem cupom.
 */
async function registrarUsoCupom(pagamentoId) {
  try {
    const [[pg]] = await db.query("SELECT empresa_id, cupom_id FROM pagamentos WHERE id = ?", [pagamentoId]);
    if (!pg || !pg.cupom_id) return false;
    const [ins] = await db.query("INSERT IGNORE INTO cupom_usos (empresa_id, cupom_id, pagamento_id) VALUES (?, ?, ?)", [pg.empresa_id, pg.cupom_id, pagamentoId]);
    if (!ins.affectedRows) return false;
    await db.query("UPDATE cupons SET usos = usos + 1 WHERE id = ? AND empresa_id = ?", [pg.cupom_id, pg.empresa_id]);
    return true;
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE" && err.code !== "ER_BAD_FIELD_ERROR") console.warn("[cupom] uso nao registrado:", err.message);
    return false;
  }
}

module.exports = { VALOR_MINIMO, MSG_INVALIDO, normalizarCodigo, validarCupomAdmin, calcularDesconto, resolverCupom, registrarUsoCupom };
