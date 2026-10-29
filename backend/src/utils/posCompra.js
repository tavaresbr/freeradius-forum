// Configuracao do pos-compra / avaliacoes (WhatsApp). Funcoes puras, sem banco.
const { normalizarTelefone } = require("../services/whatsappNotify");

const HORAS_MIN = 1;
const HORAS_MAX = 72;
const MAX_TEXTO = 1000;
const MAX_TELEFONES = 3;

const MSG_AGRADECIMENTO = "Olá {{nome}}! Obrigado pela compra do plano {{plano}} na {{empresa}}. Se precisar de ajuda, é só responder esta mensagem.";
const MSG_AVALIACAO = "Que bom que você gostou, {{nome}}! Pode nos avaliar? Leva menos de um minuto: {{link}}";

const padrao = () => ({
  ativo: false,
  horas_apos: 2,
  msg_agradecimento: MSG_AGRADECIMENTO,
  link_avaliacao: "",
  msg_avaliacao_alta: MSG_AVALIACAO,
  alerta_nota_baixa: { ativo: false, telefones: [] },
});

/** Aceita so https com host (sem credenciais embutidas). */
function urlHttpsValida(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && String(v).length <= 500;
  } catch { return false; }
}

function validarPosCompra(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const horas = Number(b.horas_apos);
  if (!Number.isInteger(horas) || horas < HORAS_MIN || horas > HORAS_MAX) throw erro(`Enviar entre ${HORAS_MIN} e ${HORAS_MAX} horas após a compra`);
  const txt = (v) => (typeof v === "string" ? v.trim() : "");
  const msgAgr = txt(b.msg_agradecimento);
  const msgAv = txt(b.msg_avaliacao_alta);
  if (msgAgr.length > MAX_TEXTO || msgAv.length > MAX_TEXTO) throw erro(`Mensagens: máximo ${MAX_TEXTO} caracteres`);
  const link = txt(b.link_avaliacao);
  if (link && !urlHttpsValida(link)) throw erro("O link de avaliação precisa começar com https://");
  if (b.ativo && !msgAgr) throw erro("Escreva a mensagem de agradecimento");

  const a = b.alerta_nota_baixa && typeof b.alerta_nota_baixa === "object" ? b.alerta_nota_baixa : {};
  const brutos = Array.isArray(a.telefones) ? a.telefones : [];
  if (brutos.length > MAX_TELEFONES) throw erro(`Máximo de ${MAX_TELEFONES} telefones`);
  const telefones = [];
  for (const t of brutos) {
    if (String(t || "").trim() === "") continue;
    const n = normalizarTelefone(t);
    if (!n) throw erro("Telefone inválido. Use DDD + número.");
    if (!telefones.includes(n)) telefones.push(n);
  }
  if (a.ativo && !telefones.length) throw erro("Informe ao menos um telefone para receber o alerta de nota baixa");
  return {
    ativo: !!b.ativo,
    horas_apos: horas,
    msg_agradecimento: msgAgr,
    link_avaliacao: link,
    msg_avaliacao_alta: msgAv || MSG_AVALIACAO,
    alerta_nota_baixa: { ativo: !!a.ativo, telefones },
  };
}

function mesclarComPadrao(salva) {
  const s = salva && typeof salva === "object" ? salva : {};
  const p = padrao();
  return { ...p, ...s, alerta_nota_baixa: { ...p.alerta_nota_baixa, ...(s.alerta_nota_baixa || {}) } };
}

/** Telefone mascarado para o alerta ao gestor: 93 *****-1234. */
function mascararTelefone(t) {
  const d = String(t || "").replace(/\D/g, "");
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}

module.exports = { HORAS_MIN, HORAS_MAX, MSG_AGRADECIMENTO, MSG_AVALIACAO, padrao, urlHttpsValida, validarPosCompra, mesclarComPadrao, mascararTelefone };
