// Regras puras das mensagens automaticas da plataforma a empresas (boas-vindas e lembrete de ativacao).
const { CONFIG_PADRAO } = require("../constants/boasVindasDefaults");

const TEXTO_MIN = 10;
const TEXTO_MAX = 1000;

const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const dataBr = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "" : x.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

// Junta o que esta salvo com o padrao (campo ausente ou invalido cai no padrao).
function mesclarConfig(salvo) {
  const s = salvo && typeof salvo === "object" ? salvo : {};
  const l = s.lembrete_ativacao && typeof s.lembrete_ativacao === "object" ? s.lembrete_ativacao : {};
  const texto = (v, padrao) => (typeof v === "string" && v.trim().length >= TEXTO_MIN ? v : padrao);
  return {
    ativo: s.ativo === undefined ? CONFIG_PADRAO.ativo : s.ativo === true,
    mensagem: texto(s.mensagem, CONFIG_PADRAO.mensagem),
    lembrete_ativacao: {
      ativo: l.ativo === true,
      mensagem: texto(l.mensagem, CONFIG_PADRAO.lembrete_ativacao.mensagem),
    },
  };
}

// Valida o corpo do PUT. Devolve { erro } ou { config }.
function validarConfig(body) {
  const b = body && typeof body === "object" ? body : {};
  const l = b.lembrete_ativacao && typeof b.lembrete_ativacao === "object" ? b.lembrete_ativacao : {};
  const checa = (t, nome) => {
    const v = typeof t === "string" ? t.trim() : "";
    if (v.length < TEXTO_MIN) return `${nome}: escreva ao menos ${TEXTO_MIN} caracteres.`;
    if (v.length > TEXTO_MAX) return `${nome}: no máximo ${TEXTO_MAX} caracteres.`;
    return null;
  };
  const e1 = checa(b.mensagem, "Mensagem de boas-vindas");
  if (e1) return { erro: e1 };
  const e2 = checa(l.mensagem, "Mensagem do lembrete");
  if (e2) return { erro: e2 };
  return {
    config: {
      ativo: b.ativo === true,
      mensagem: b.mensagem.trim(),
      lembrete_ativacao: { ativo: l.ativo === true, mensagem: l.mensagem.trim() },
    },
  };
}

// Texto manual digitado pelo dono (1..1000).
function validarTextoManual(v) {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return { erro: "Escreva a mensagem." };
  if (t.length > TEXTO_MAX) return { erro: `A mensagem pode ter no máximo ${TEXTO_MAX} caracteres.` };
  return { texto: t };
}

function montarVars({ empresa, plano, trialAte, venceEm, linkPainel }) {
  return {
    nome: primeiroNome(empresa && empresa.nome) || "tudo bem",
    empresa: (empresa && empresa.nome) || "",
    plano: plano || "",
    trial_ate: dataBr(trialAte),
    vence_em: dataBr(venceEm),
    link_painel: linkPainel || "",
  };
}

// Link do login da empresa (so com SYSTEM_DOMAIN definido; senao vazio).
function linkPainelDaEmpresa(slug, dominio = process.env.SYSTEM_DOMAIN) {
  const host = String(dominio || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return host && slug ? `https://${host}/login/${slug}` : "";
}

module.exports = { mesclarConfig, validarConfig, validarTextoManual, montarVars, linkPainelDaEmpresa, primeiroNome, TEXTO_MIN, TEXTO_MAX };
