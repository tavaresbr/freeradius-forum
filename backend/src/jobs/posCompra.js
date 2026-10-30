// Agradecimento pos-compra por WhatsApp. Roda a cada 10 min (cron do server.js).
// So empresas com config_json.pos_compra.ativo (desligado por padrao). Pagamentos aprovados cuja liberacao
// ocorreu ha pelo menos N horas e no maximo 3 dias (ligar o recurso nunca dispara o historico antigo).
// Telefone so pelo cadastro (pagamento/lead por cliente_id ou CPF; nunca por MAC). 1 envio por pagamento.
const naoPerturbe = require("../utils/naoPerturbe");
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog, normalizarTelefone, renderTemplate } = require("../services/whatsappNotify");
const { mesclarComPadrao } = require("../utils/posCompra");
const { reservar } = require("../services/whatsappPosCompra");

const MAX_POR_RODADA = 5;
const JANELA_MAX_DIAS = 3;
const INTERVALO_MS = [3000, 8000];

let emExecucao = false;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "cliente";

async function empresasComPosCompra() {
  const [rows] = await db.query("SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp' AND config_json LIKE '%pos_compra%'");
  const out = [];
  for (const r of rows) {
    try {
      const cfg = typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json;
      if (cfg?.pos_compra && mesclarComPadrao(cfg.pos_compra).ativo) out.push({ empresaId: r.empresa_id, pos: mesclarComPadrao(cfg.pos_compra) });
    } catch { /* config ilegivel: ignora */ }
  }
  return out;
}

const SQL_PAGAMENTOS = `
  SELECT pg.id, pg.cliente_id, pg.cpf, pg.telefone, pg.nome_plano
    FROM pagamentos pg
   WHERE pg.empresa_id = ? AND pg.status = 'approved' AND pg.liberado_em IS NOT NULL
     AND pg.liberado_em <= DATE_SUB(NOW(), INTERVAL ? HOUR)
     AND pg.liberado_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
     AND NOT EXISTS (SELECT 1 FROM whatsapp_pos_compra w WHERE w.empresa_id = pg.empresa_id AND w.etapa = 'agradecimento' AND w.referencia_id = pg.id)
   ORDER BY pg.liberado_em LIMIT 50`;

async function processarEmpresa({ empresaId, pos }, dormirFn) {
  if (!(await temRecurso(empresaId, "whatsapp"))) return 0;
  if (await naoPerturbe.emSilencio(empresaId, "pos_compra")) return 0; // adia: nada e reservado
  if (!(await instanciaConectada(empresaId))) return 0;
  const [pagamentos] = await db.query(SQL_PAGAMENTOS, [empresaId, pos.horas_apos, JANELA_MAX_DIAS]);
  const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);
  const jaNaRodada = new Set();
  let enviados = 0;
  for (const p of pagamentos) {
    if (enviados >= MAX_POR_RODADA) break;
    let lead = null;
    if (p.cliente_id) [[lead]] = await db.query("SELECT id, nome, telefone, whatsapp_optout FROM leads WHERE id = ? AND empresa_id = ?", [p.cliente_id, empresaId]);
    if (!lead && p.cpf) {
      const cpf = String(p.cpf).replace(/\D/g, "");
      if (cpf.length === 11) [[lead]] = await db.query(
        "SELECT id, nome, telefone, whatsapp_optout FROM leads WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ? ORDER BY id LIMIT 1", [empresaId, cpf]);
    }
    if (lead && Number(lead.whatsapp_optout) === 1) { await reservar(empresaId, "agradecimento", p.id); continue; }
    const telefone = normalizarTelefone(p.telefone || lead?.telefone);
    if (!telefone) { await reservar(empresaId, "agradecimento", p.id); continue; } // sem telefone: nao tenta de novo
    if (await naoPerturbe.estaBloqueado(empresaId, telefone)) { await reservar(empresaId, "agradecimento", p.id); continue; }
    if (jaNaRodada.has(telefone)) { await reservar(empresaId, "agradecimento", p.id); continue; } // varias compras do mesmo numero: 1 mensagem
    if (!(await reservar(empresaId, "agradecimento", p.id))) continue;
    jaNaRodada.add(telefone);
    const mensagem = renderTemplate(pos.msg_agradecimento, { nome: primeiroNome(lead?.nome), plano: p.nome_plano || "", empresa: emp?.nome || "" }).trim();
    try {
      await enviarMensagemEstrita(telefone, mensagem, empresaId);
      await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "pos_compra", referencia_id: p.id, status: "ok" });
    } catch (err) {
      const msg = String(err.response?.data?.message || err.message || "Erro ao enviar").slice(0, 500);
      await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "pos_compra", referencia_id: p.id, status: "erro", erro_msg: msg });
    }
    enviados++;
    if (enviados < MAX_POR_RODADA) await dormirFn(intervalo());
  }
  return enviados;
}

async function posCompra(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    let total = 0;
    for (const e of await empresasComPosCompra()) {
      try { total += await processarEmpresa(e, opts.dormir || dormir); }
      catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.error(`[pos-compra] empresa ${e.empresaId}:`, err.message); }
    }
    return { enviados: total };
  } finally {
    emExecucao = false;
  }
}

module.exports = posCompra;

if (require.main === module) {
  posCompra().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
