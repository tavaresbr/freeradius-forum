// Alerta de equipamento offline: validacao da config e maquina de estados. Funcoes puras, sem banco.
const { normalizarTelefone } = require("../services/whatsappNotify");

const MAX_TELEFONES = 3;
const FALHAS_MIN = 2;
const FALHAS_MAX = 10;
const FALHAS_PADRAO = 3;

const padrao = () => ({ ativo: false, telefones: [], falhas: FALHAS_PADRAO, avisar_volta: true });

function validarAlerta(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const brutos = Array.isArray(b.telefones) ? b.telefones : [];
  if (brutos.length > MAX_TELEFONES) throw erro(`Máximo de ${MAX_TELEFONES} telefones`);
  const telefones = [];
  for (const t of brutos) {
    if (String(t || "").trim() === "") continue;
    const n = normalizarTelefone(t);
    if (!n) throw erro("Telefone inválido. Use DDD + número.");
    if (!telefones.includes(n)) telefones.push(n);
  }
  const falhas = Number(b.falhas);
  if (!Number.isInteger(falhas) || falhas < FALHAS_MIN || falhas > FALHAS_MAX) throw erro(`Falhas seguidas: entre ${FALHAS_MIN} e ${FALHAS_MAX}`);
  if (b.ativo && !telefones.length) throw erro("Informe ao menos um telefone para receber os alertas");
  return { ativo: !!b.ativo, telefones, falhas, avisar_volta: b.avisar_volta !== false };
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

/**
 * Proximo estado de UM equipamento a cada verificacao.
 * @param {{online:boolean, falhas:number, alertado:boolean, falha_desde:Date|null}|null} atual linha salva (null = primeira vez)
 * @param {boolean} ok resultado do teste
 * @param {Date} agora
 * @param {{falhas:number, avisar_volta:boolean}} cfg
 * @returns {{estado:{online:boolean, falhas:number, alertado:boolean, falha_desde:Date|null}, acao:null|'offline'|'voltou', fora_min?:number}}
 */
function proximoEstado(atual, ok, agora, cfg) {
  const base = atual || { online: true, falhas: 0, alertado: false, falha_desde: null };
  if (ok) {
    const estavaAlertado = !!base.alertado;
    const foraMin = base.falha_desde ? Math.max(1, Math.round((agora - new Date(base.falha_desde)) / 60000)) : null;
    return {
      estado: { online: true, falhas: 0, alertado: false, falha_desde: null },
      acao: estavaAlertado && cfg.avisar_volta ? "voltou" : null,
      fora_min: foraMin,
    };
  }
  const falhas = (base.falhas || 0) + 1;
  const desde = base.falha_desde ? new Date(base.falha_desde) : agora;
  if (falhas >= cfg.falhas && !base.alertado) {
    return { estado: { online: false, falhas, alertado: true, falha_desde: desde }, acao: "offline" };
  }
  return { estado: { online: base.alertado ? false : base.online, falhas, alertado: !!base.alertado, falha_desde: desde }, acao: null };
}

const hora = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function mensagemOffline(eq, desde) {
  return `⚠️ Equipamento OFFLINE: ${eq.nome}${eq.ip ? ` (${eq.ip})` : ""}\nSem resposta desde ${hora(desde)}.`;
}
function mensagemVoltou(eq, foraMin) {
  return `✅ Equipamento de volta: ${eq.nome}${eq.ip ? ` (${eq.ip})` : ""}${foraMin ? `\nFicou fora por cerca de ${foraMin} min.` : ""}`;
}

module.exports = { MAX_TELEFONES, FALHAS_PADRAO, padrao, validarAlerta, mesclarComPadrao, proximoEstado, mensagemOffline, mensagemVoltou };
