// Configuracao do aviso "seu tempo esta acabando" (WhatsApp). Funcoes puras, sem banco.
const MIN_MINUTOS = 5;
const MAX_MINUTOS = 60;
const MAX_TEMPLATE = 1000;
const TEMPLATE_PADRAO = "Olá {{nome}}! Seu tempo de internet acaba em cerca de {{minutos}} minutos. Para continuar conectado, escolha um plano: {{link}}";

const padrao = () => ({ ativo: false, minutos: 10, template: TEMPLATE_PADRAO });

/** Valida/normaliza o corpo vindo do navegador. Lanca Error (com .status = 400) se invalido. */
function validarAviso(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const minutos = Number(b.minutos);
  if (!Number.isInteger(minutos) || minutos < MIN_MINUTOS || minutos > MAX_MINUTOS) {
    throw erro(`Avisar entre ${MIN_MINUTOS} e ${MAX_MINUTOS} minutos antes do fim`);
  }
  const template = typeof b.template === "string" ? b.template.trim() : "";
  if (template.length > MAX_TEMPLATE) throw erro(`Mensagem: máximo ${MAX_TEMPLATE} caracteres`);
  if (b.ativo && !template) throw erro("Escreva a mensagem do aviso");
  return { ativo: !!b.ativo, minutos, template };
}

/** Config salva (ou parcial) preenchida com os padroes. */
function mesclarComPadrao(salva) {
  return { ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) };
}

module.exports = { MIN_MINUTOS, MAX_MINUTOS, MAX_TEMPLATE, TEMPLATE_PADRAO, padrao, validarAviso, mesclarComPadrao };
