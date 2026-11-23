// Numero de WhatsApp de ENVIO (Fase 2 de varios numeros). Respostas dentro de uma conversa saem sempre pelo numero
// da conversa; envios proativos sem conversa (renovacao, pos-compra, avisos, alertas...) usam o "numero padrao"
// da empresa (config_json.numero_envios.numero_id, 0 = principal). Numero removido => volta ao principal.
const numeros = require("./whatsappNumeros");

/** Aceita inteiro >= 0 (0 = principal); qualquer outra coisa = null. */
function idValido(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Numero padrao dos envios automaticos da empresa (nunca lanca). */
async function numeroPadrao(empresaId) {
  try {
    const { lerConfigJson } = require("../services/whatsappAutomacao");
    const cfg = await lerConfigJson(empresaId);
    const id = idValido(cfg?.numero_envios?.numero_id);
    if (!id) return 0;
    return (await numeros.obter(empresaId, id)) ? id : 0;
  } catch {
    return 0;
  }
}

/** Confere que `v` e' o principal (0) ou um numero DA empresa. Devolve o id ou lanca erro 400. */
async function validarNumero(empresaId, v) {
  const id = idValido(v);
  if (id === null) throw Object.assign(new Error("Número de WhatsApp inválido"), { status: 400 });
  if (id > 0 && !(await numeros.obter(empresaId, id))) throw Object.assign(new Error("Número de WhatsApp não encontrado"), { status: 400 });
  return id;
}

module.exports = { idValido, numeroPadrao, validarNumero };
