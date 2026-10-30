// Configuracao da automacao do atendimento (horario + mensagens). Funcoes puras, sem banco.
const FUSO_PADRAO = "America/Sao_Paulo";
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_MSG = 1000;

const padrao = () => ({
  ativo: false,
  fuso: FUSO_PADRAO,
  usar_horario: false,
  horarios: Array.from({ length: 7 }, (_, d) => ({ ativo: d >= 1 && d <= 5, de: "08:00", ate: "18:00" })), // 0 = domingo
  msg_boas_vindas: "",
  msg_fora_horario: "",
  pedir_nota: false, // ao resolver, pede nota de 1 a 5
  msg_pedir_nota: "De 1 a 5, como foi o nosso atendimento? Responda só com o número.",
  ia_sugestao: false, // permite "Sugerir resposta" por IA (envia trechos da conversa a Anthropic)
});

function fusoValido(fuso) {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: fuso }); return true; } catch { return false; }
}

/** Valida/normaliza o corpo vindo do navegador. Lanca Error (com .status = 400) se invalido. */
function validarAutomacao(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const base = padrao();
  const fuso = typeof b.fuso === "string" && b.fuso ? b.fuso : FUSO_PADRAO;
  if (!fusoValido(fuso)) throw erro("Fuso horário inválido");
  const horarios = base.horarios.map((padraoDia, d) => {
    const h = Array.isArray(b.horarios) ? b.horarios[d] : null;
    if (!h) return padraoDia;
    const dia = { ativo: !!h.ativo, de: String(h.de || padraoDia.de), ate: String(h.ate || padraoDia.ate) };
    if (!HORA.test(dia.de) || !HORA.test(dia.ate)) throw erro("Horário inválido (use HH:MM)");
    if (dia.ativo && dia.de >= dia.ate) throw erro("O horário de início deve ser antes do fim");
    return dia;
  });
  const msg = (v, nome) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > MAX_MSG) throw erro(`${nome}: máximo ${MAX_MSG} caracteres`);
    return t;
  };
  const cfg = {
    ativo: !!b.ativo,
    fuso,
    usar_horario: !!b.usar_horario,
    horarios,
    msg_boas_vindas: msg(b.msg_boas_vindas, "Boas-vindas"),
    msg_fora_horario: msg(b.msg_fora_horario, "Fora do horário"),
    pedir_nota: !!b.pedir_nota,
    msg_pedir_nota: msg(b.msg_pedir_nota, "Pesquisa de satisfação") || base.msg_pedir_nota,
    ia_sugestao: !!b.ia_sugestao,
  };
  if (cfg.ativo && !cfg.msg_boas_vindas && !(cfg.usar_horario && cfg.msg_fora_horario)) {
    throw erro("Escreva ao menos uma mensagem (boas-vindas ou fora do horário)");
  }
  return cfg;
}

/** Config salva (ou parcial) preenchida com os padroes. */
function mesclarComPadrao(salva) {
  const p = padrao();
  if (!salva || typeof salva !== "object") return p;
  return { ...p, ...salva, horarios: p.horarios.map((d, i) => ({ ...d, ...(salva.horarios?.[i] || {}) })) };
}

/** Dia da semana (0 = domingo) e "HH:MM" da data no fuso informado. */
function partesNoFuso(data, fuso) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(data).map((x) => [x.type, x.value]));
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dia, hora: `${p.hour}:${p.minute}` };
}

/** true se estiver dentro do horario de atendimento (sem horario configurado = sempre dentro). */
function dentroDoHorario(cfg, data = new Date()) {
  if (!cfg?.usar_horario) return true;
  const { dia, hora } = partesNoFuso(data, cfg.fuso || FUSO_PADRAO);
  const h = cfg.horarios?.[dia];
  return !!(h && h.ativo && hora >= h.de && hora < h.ate);
}

/** {{nome}} (primeiro nome ou "cliente") e {{empresa}}. */
function renderizar(modelo, { nome, empresa }) {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "cliente";
  return String(modelo || "").replace(/\{\{\s*nome\s*\}\}/gi, primeiro).replace(/\{\{\s*empresa\s*\}\}/gi, empresa || "").trim();
}

module.exports = { FUSO_PADRAO, MAX_MSG, partesNoFuso, padrao, validarAutomacao, mesclarComPadrao, dentroDoHorario, renderizar };
