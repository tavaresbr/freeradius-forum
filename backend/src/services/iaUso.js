// Uso mensal da IA por empresa (tabela ia_uso, migration 077). `reservar` e' atomico: duas mensagens ao mesmo
// tempo nunca passam do limite do plano. Sem a tabela, nao reserva (a IA nao responde): fail-closed, ela gera custo.
const db = require("../../db");
const { obterStatus } = require("../utils/assinatura");

const mesAtual = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const tabelaAusente = (e) => e && (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146);

/** { usadas, limite (null = ilimitado), restantes (null = ilimitado) } do mes. */
async function situacao(empresaId, mes = mesAtual()) {
  let usadas = 0;
  try {
    const [[r]] = await db.query("SELECT respostas FROM ia_uso WHERE empresa_id = ? AND mes = ?", [empresaId, mes]);
    usadas = Number(r?.respostas) || 0;
  } catch (e) { if (!tabelaAusente(e)) throw e; }
  const st = await obterStatus(empresaId).catch(() => ({}));
  const limite = st.ia_respostas_mes == null ? null : Number(st.ia_respostas_mes);
  return { mes, usadas, limite, restantes: limite == null ? null : Math.max(0, limite - usadas) };
}

/**
 * Reserva 1 resposta no mes. true = pode responder. Atomico: o INSERT ... ON DUPLICATE so incrementa abaixo do limite.
 * `limite` null = ilimitado (so conta).
 */
async function reservar(empresaId, limite, mes = mesAtual()) {
  try {
    if (limite == null) {
      await db.query("INSERT INTO ia_uso (empresa_id, mes, respostas) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE respostas = respostas + 1", [empresaId, mes]);
      return true;
    }
    if (!(limite > 0)) return false;
    const [r] = await db.query("INSERT IGNORE INTO ia_uso (empresa_id, mes, respostas) VALUES (?, ?, 0)", [empresaId, mes]);
    void r;
    const [u] = await db.query("UPDATE ia_uso SET respostas = respostas + 1 WHERE empresa_id = ? AND mes = ? AND respostas < ?", [empresaId, mes, limite]);
    return u.affectedRows > 0;
  } catch (e) {
    if (tabelaAusente(e)) return false;
    throw e;
  }
}

/** Devolve a reserva quando a chamada ao Claude falhou antes de responder. */
async function devolver(empresaId, mes = mesAtual()) {
  await db.query("UPDATE ia_uso SET respostas = GREATEST(respostas - 1, 0) WHERE empresa_id = ? AND mes = ?", [empresaId, mes]).catch(() => {});
}

/** Soma tokens gastos (melhor esforco: nunca derruba o atendimento). */
async function registrarTokens(empresaId, entrada, saida, mes = mesAtual()) {
  try {
    await db.query(
      "INSERT INTO ia_uso (empresa_id, mes, tokens_in, tokens_out) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tokens_in = tokens_in + VALUES(tokens_in), tokens_out = tokens_out + VALUES(tokens_out)",
      [empresaId, mes, Math.max(0, entrada | 0), Math.max(0, saida | 0)]
    );
  } catch { /* contagem de tokens e' informativa */ }
}

module.exports = { mesAtual, situacao, reservar, devolver, registrarTokens };
