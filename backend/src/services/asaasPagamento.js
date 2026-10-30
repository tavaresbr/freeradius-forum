const db = require("../../db");
const asaas = require("../utils/asaasClient");
const { liberarUsuario } = require("../controllers/mikrotikAPIController");
const { registrarUsoCupom } = require("../utils/cupons");
const { PAGADOR_DESCONHECIDO } = require("../utils/pagadorCpf");

/**
 * Confere no Asaas (nunca pelo corpo do webhook) se a cobranca do pagamento interno foi paga e, se sim,
 * aprova e libera o acesso. Idempotente: webhook repetido e polling convivem (marcador `liberado_em`).
 * Devolve 'approved' | 'pending' | 'ignorado'.
 */
async function confirmarComCredencial(pagamentoId) {
  let cred = null;
  const [[pag]] = await db.query(
    `SELECT id, empresa_id, plano_id, status, valor, mp_pagamento_id, gateway,
            mac, IP AS ip, nome_plano, cpf, cliente_id, portal_id, telefone
       FROM pagamentos WHERE id = ?`,
    [pagamentoId]
  );
  if (!pag || pag.gateway !== "asaas" || !pag.mp_pagamento_id) return { resultado: "ignorado", cred };

  const cfg = await asaas.carregarConfig(pag.empresa_id);
  if (!cfg?.api_key) return { resultado: "ignorado", cred };

  if (pag.status !== "approved" && pag.status !== "expirado") {
    const cobranca = await asaas.obterCobranca(cfg, pag.mp_pagamento_id);
    if (!asaas.STATUS_PAGO.includes(cobranca.status)) return { resultado: "pending", cred };

    // A cobranca precisa ser exatamente a deste registro (referencia e valor), senao um pagamento real e
    // barato aprovaria um caro ainda em aberto.
    if (cobranca.externalReference !== `pag_${pag.id}_emp_${pag.empresa_id}`) {
      console.warn(`[asaas] externalReference nao confere (pag=${pag.id}): nao aprova`);
      return { resultado: "ignorado", cred };
    }
    const esperado = Number(pag.valor) / 100; // pagamentos.valor guarda CENTAVOS; o Asaas usa reais
    if (Math.abs(esperado - Number(cobranca.value)) > 0.01) {
      console.warn(`[asaas] valor pago (${cobranca.value}) diferente do esperado (${esperado}) (pag=${pag.id}): nao aprova`);
      return { resultado: "ignorado", cred };
    }

    let duracao = 60;
    if (pag.plano_id) {
      const [[plano]] = await db.query(
        "SELECT duracao_minutos FROM planos WHERE id = ? AND empresa_id = ?",
        [pag.plano_id, pag.empresa_id]
      );
      if (plano?.duracao_minutos) duracao = plano.duracao_minutos;
    }
    // Asaas nao informa quem pagou: o pagamento NAO confirma o CPF do cadastro (marcador, como no PIX sem pagador).
    await db.query(
      `UPDATE pagamentos SET status = 'approved', expira_em = DATE_ADD(NOW(), INTERVAL ? MINUTE),
              pagador_cpf = COALESCE(pagador_cpf, ?)
        WHERE id = ? AND status NOT IN ('approved', 'expirado')`,
      [duracao, PAGADOR_DESCONHECIDO, pag.id]
    );
  }

  // Idempotencia atomica da liberacao (mesmo marcador do webhook MP, polling e cartao).
  if (pag.mac && pag.nome_plano) {
    const [m] = await db.query(
      "UPDATE pagamentos SET liberado_em = NOW() WHERE id = ? AND status = 'approved' AND liberado_em IS NULL",
      [pag.id]
    );
    if (m.affectedRows > 0) {
      await registrarUsoCupom(pag.id);
      try {
        cred = await liberarUsuario({
          mac: pag.mac,
          ip: pag.ip,
          plano: pag.nome_plano,
          empresa_id: pag.empresa_id,
          cpf: pag.cpf || null,
          cliente_id: pag.cliente_id || null,
          portal_id: pag.portal_id || null,
          telefone: pag.telefone || null,
          contexto_tipo: "pagamento_pix",
          empilharTempo: true,
          referencia_id: pag.id,
        });
      } catch (err) {
        console.error("[asaas] erro ao liberar usuario:", err.message);
        await db.query("UPDATE pagamentos SET liberado_em = NULL, observacao = ? WHERE id = ?", [
          `Erro ao liberar: ${err.message}`.slice(0, 250), pag.id,
        ]);
      }
    }
  }
  return { resultado: "approved", cred };
}

/** Devolve 'approved' | 'pending' | 'ignorado'. */
async function confirmarPagamentoAsaas(pagamentoId) {
  return (await confirmarComCredencial(pagamentoId)).resultado;
}

module.exports = { confirmarPagamentoAsaas, confirmarComCredencial };
