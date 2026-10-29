// Configuracao da renovacao por WhatsApp (lembrete depois que a compra do portal venceu). Funcoes puras, sem banco.
const DIAS_PERMITIDOS = [0, 1, 2, 3, 5, 7, 10, 14, 30];
const MAX_ETAPAS = 3;
const MAX_TEMPLATE = 1000;
const TEMPLATE_PADRAO = "Olá {{nome}}! Seu plano {{plano}} da {{empresa}} acabou. Para voltar a navegar, escolha um plano aqui: {{link}}";
const CUPOM_OK = /^[A-Z0-9]{3,32}$/;

const padrao = () => ({ ativo: false, dias: [0, 3, 7], template: TEMPLATE_PADRAO, cupom: "" });

function validarRenovacao(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const brutos = Array.isArray(b.dias) ? b.dias.map(Number) : [];
  const dias = [...new Set(brutos)].sort((x, y) => x - y);
  if (dias.some((d) => !DIAS_PERMITIDOS.includes(d))) throw erro("Dias inválidos para o lembrete");
  if (dias.length > MAX_ETAPAS) throw erro(`Escolha no máximo ${MAX_ETAPAS} lembretes`);
  if (b.ativo && !dias.length) throw erro("Escolha ao menos um dia para o lembrete");
  const template = typeof b.template === "string" ? b.template.trim() : "";
  if (template.length > MAX_TEMPLATE) throw erro(`Mensagem: máximo ${MAX_TEMPLATE} caracteres`);
  if (b.ativo && !template) throw erro("Escreva a mensagem do lembrete");
  if (b.ativo && !template.includes("{{link}}")) throw erro("A mensagem precisa ter {{link}} (o link para escolher o plano)");
  const cupom = typeof b.cupom === "string" ? b.cupom.trim().toUpperCase() : "";
  if (cupom && !CUPOM_OK.test(cupom)) throw erro("Cupom: 3 a 32 letras ou números");
  return { ativo: !!b.ativo, dias, template, cupom };
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

/** Acrescenta ?cupom= ao link de planos quando a empresa configurou um cupom valido. */
function comCupom(link, cupom) {
  if (!link || !cupom || !CUPOM_OK.test(String(cupom))) return link;
  return `${link}${link.includes("?") ? "&" : "?"}cupom=${encodeURIComponent(cupom)}`;
}

module.exports = { DIAS_PERMITIDOS, MAX_ETAPAS, TEMPLATE_PADRAO, padrao, validarRenovacao, mesclarComPadrao, comCupom };
