// Alerta de equipamento offline por WhatsApp. Roda a cada 5 min (cron do server.js).
// Por empresa com o alerta LIGADO (config_json.alerta_equipamentos, desligado por padrao): testa cada equipamento pelo
// driver, guarda o estado em equipamento_status e avisa os telefones da config so apos N falhas SEGUIDAS (1 aviso por queda
// + 1 aviso de volta). Nunca derruba o servidor: erro de um equipamento nao impede os outros.
const db = require("../../db");
const { erroEvolution } = require("../utils/erroEvolution");
const { temRecurso } = require("../utils/assinatura");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog } = require("../services/whatsappNotify");
const { getDriver } = require("../gateways");
const al = require("../utils/alertaEquipamentos");

const TIMEOUT_MS = 10000;
const INTERVALO_MS = [3000, 8000];
let emExecucao = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));

/** true = respondeu. Excecao, timeout ou {sucesso:false} = false (com o motivo curto). */
async function testar(eq, testarFn) {
  try {
    const r = await Promise.race([
      testarFn(eq),
      new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), TIMEOUT_MS)),
    ]);
    if (r && r.sucesso === false) return { ok: false, erro: String(r.erro || "sem resposta").slice(0, 200) };
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err.message || "falha").slice(0, 200) };
  }
}

const padraoTeste = (eq) => getDriver(eq).testConnection(eq);

async function empresasComAlerta() {
  const [rows] = await db.query("SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp' AND config_json LIKE '%alerta_equipamentos%'");
  const out = [];
  for (const r of rows) {
    try {
      const cfg = typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json;
      const alerta = al.mesclarComPadrao(cfg?.alerta_equipamentos);
      if (cfg?.alerta_equipamentos && alerta.ativo && alerta.telefones.length) out.push({ empresaId: r.empresa_id, alerta });
    } catch { /* config ilegivel: ignora */ }
  }
  return out;
}

async function avisar(empresaId, telefones, mensagem, dormirFn) {
  for (let i = 0; i < telefones.length; i++) {
    try {
      await enviarMensagemEstrita(telefones[i], mensagem, empresaId);
      await gravarLog({ empresa_id: empresaId, telefone: telefones[i], mensagem, contexto_tipo: "alerta_equipamento", status: "ok" });
    } catch (err) {
      const msg = String(erroEvolution(err)).slice(0, 500);
      await gravarLog({ empresa_id: empresaId, telefone: telefones[i], mensagem, contexto_tipo: "alerta_equipamento", status: "erro", erro_msg: msg });
    }
    if (i < telefones.length - 1) await dormirFn(intervalo());
  }
}

async function processarEmpresa({ empresaId, alerta }, { dormirFn, testarFn, agora }) {
  if (!(await temRecurso(empresaId, "whatsapp"))) return 0;
  const conectada = await instanciaConectada(empresaId);
  const [equipamentos] = await db.query("SELECT * FROM mikrotiks WHERE empresa_id = ? ORDER BY id", [empresaId]);
  const [estados] = await db.query("SELECT * FROM equipamento_status WHERE empresa_id = ?", [empresaId]);
  const porId = new Map(estados.map((e) => [e.mikrotik_id, e]));
  let avisos = 0;
  for (const eq of equipamentos) {
    const t = await testar(eq, testarFn);
    const salvo = porId.get(eq.id);
    const atual = salvo ? { online: !!salvo.online, falhas: salvo.falhas, alertado: !!salvo.alertado, falha_desde: salvo.falha_desde } : null;
    const r = al.proximoEstado(atual, t.ok, agora, alerta);
    // O aviso so conta como feito se o WhatsApp esta conectado: senao a proxima rodada tenta de novo.
    let estado = r.estado;
    let acao = r.acao;
    if (acao && !conectada) { acao = null; estado = { ...estado, alertado: atual ? atual.alertado : false, falha_desde: estado.falha_desde || (atual ? atual.falha_desde : null) }; }
    await db.query(
      `INSERT INTO equipamento_status (mikrotik_id, empresa_id, online, falhas, falha_desde, alertado, alertado_em, verificado_em, erro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE online = VALUES(online), falhas = VALUES(falhas), falha_desde = VALUES(falha_desde), alertado = VALUES(alertado),
         alertado_em = IF(VALUES(alertado) = 1, COALESCE(alertado_em, VALUES(alertado_em)), NULL), verificado_em = VALUES(verificado_em), erro = VALUES(erro)`,
      [eq.id, empresaId, estado.online ? 1 : 0, estado.falhas, estado.falha_desde, estado.alertado ? 1 : 0, acao === "offline" ? agora : null, agora, t.ok ? null : t.erro]
    );
    if (acao === "offline") { await avisar(empresaId, alerta.telefones, al.mensagemOffline(eq, estado.falha_desde || agora), dormirFn); avisos++; }
    else if (acao === "voltou") { await avisar(empresaId, alerta.telefones, al.mensagemVoltou(eq, r.fora_min), dormirFn); avisos++; }
  }
  return avisos;
}

// opts.dormir / opts.testar / opts.agora permitem aos testes nao esperar nem tocar equipamentos de verdade
async function alertaEquipamentos(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    let total = 0;
    for (const e of await empresasComAlerta()) {
      try { total += await processarEmpresa(e, { dormirFn: opts.dormir || dormir, testarFn: opts.testar || padraoTeste, agora: opts.agora || new Date() }); }
      catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.error(`[alerta-equipamentos] empresa ${e.empresaId}:`, err.message); }
    }
    return { avisos: total };
  } finally {
    emExecucao = false;
  }
}

module.exports = alertaEquipamentos;
module.exports.testar = testar;

if (require.main === module) {
  alertaEquipamentos().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
