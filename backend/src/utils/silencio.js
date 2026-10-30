// Horario de silencio ("nao perturbe") das mensagens proativas. Funcoes puras, sem banco.
const { partesNoFuso, FUSO_PADRAO } = require("./horarioAtendimento");

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIPOS = ["promocao", "renovacao", "pos_compra", "aviso_expiracao", "manutencao"];

const padrao = () => ({
  ativo: false,
  fuso: FUSO_PADRAO,
  de: "21:00",
  ate: "08:00",
  dias: [0, 1, 2, 3, 4, 5, 6], // dias da semana (0 = domingo) em que a noite de silencio comeca
  aplicar_a: ["promocao", "renovacao", "pos_compra", "manutencao"],
});

function fusoValido(f) {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: f }); return true; } catch { return false; }
}

/** Valida o corpo vindo do navegador. Lanca Error com .status = 400. */
function validarSilencio(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const base = padrao();
  const fuso = typeof b.fuso === "string" && b.fuso ? b.fuso : base.fuso;
  if (!fusoValido(fuso)) throw erro("Fuso horário inválido");
  const de = String(b.de || base.de);
  const ate = String(b.ate || base.ate);
  if (!HORA.test(de) || !HORA.test(ate)) throw erro("Horário inválido (use HH:MM)");
  if (de === ate) throw erro("O início e o fim do silêncio não podem ser iguais");
  const dias = Array.isArray(b.dias) ? [...new Set(b.dias.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : base.dias;
  const aplicar_a = Array.isArray(b.aplicar_a) ? [...new Set(b.aplicar_a.map(String))].filter((t) => TIPOS.includes(t)) : base.aplicar_a;
  if (b.ativo && !dias.length) throw erro("Escolha ao menos um dia");
  return { ativo: !!b.ativo, fuso, de, ate, dias, aplicar_a };
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

/**
 * true se `agora` esta no silencio E o tipo de envio esta sujeito a ele.
 * Janela que cruza a meia-noite (21:00 -> 08:00): a parte da madrugada pertence ao dia anterior.
 */
function dentroDoSilencio(cfg, tipo, agora = new Date()) {
  if (!cfg || !cfg.ativo) return false;
  if (tipo && !(cfg.aplicar_a || []).includes(tipo)) return false;
  const { dia, hora } = partesNoFuso(agora, cfg.fuso || FUSO_PADRAO);
  const dias = cfg.dias || [];
  if (cfg.de < cfg.ate) return dias.includes(dia) && hora >= cfg.de && hora < cfg.ate;
  if (hora >= cfg.de) return dias.includes(dia);
  if (hora < cfg.ate) return dias.includes((dia + 6) % 7);
  return false;
}

module.exports = { TIPOS, padrao, validarSilencio, mesclarComPadrao, dentroDoSilencio };
