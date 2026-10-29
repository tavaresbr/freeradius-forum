// Lembrete de renovacao por WhatsApp. Roda a cada hora (cron do server.js).
// So empresas com config_json.renovacao.ativo (desligado por padrao). Para cada "dias apos o vencimento" configurado,
// pega a ULTIMA compra paga do cliente (sem compra posterior) que venceu ha D dias (janela de 2 dias: ligar o recurso
// nunca dispara o historico antigo). Telefone so pelo cadastro (pagamento/lead), nunca por MAC. 1 lembrete por
// compra e etapa (UNIQUE), no maximo 1 por telefone a cada 20 h, 5 por empresa por rodada.
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog, normalizarTelefone, renderTemplate } = require("../services/whatsappNotify");
const { mesclarComPadrao, comCupom } = require("../utils/renovacao");
const { linkPlanosDoCliente } = require("../utils/linkPlanos");

const MAX_POR_RODADA = 5;
const JANELA_DIAS = 2;
const INTERVALO_MS = [3000, 8000];

let emExecucao = false;
const dormirPadrao = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "cliente";

async function empresasComRenovacao() {
  const [rows] = await db.query("SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp' AND config_json LIKE '%renovacao%'");
  const out = [];
  for (const r of rows) {
    try {
      const cfg = typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json;
      const ren = cfg?.renovacao && mesclarComPadrao(cfg.renovacao);
      if (ren && ren.ativo && ren.dias.length) out.push({ empresaId: r.empresa_id, ren });
    } catch { /* config ilegivel: ignora */ }
  }
  return out;
}

const SQL_CANDIDATOS = `
  SELECT pg.id, pg.cliente_id, pg.cpf, pg.telefone, pg.nome_plano, p.mikrotik_id AS nas_id
    FROM pagamentos pg
    LEFT JOIN planos p ON p.id = pg.plano_id AND p.empresa_id = pg.empresa_id
   WHERE pg.empresa_id = ? AND pg.status IN ('approved','expirado') AND pg.valor > 0 AND pg.expira_em IS NOT NULL
     AND pg.expira_em <= DATE_SUB(NOW(), INTERVAL ? DAY)
     AND pg.expira_em >= DATE_SUB(NOW(), INTERVAL ? DAY)
     AND NOT EXISTS (
       SELECT 1 FROM pagamentos pg2
        WHERE pg2.empresa_id = pg.empresa_id AND pg2.id > pg.id AND pg2.status IN ('approved','expirado')
          AND ((pg.cliente_id IS NOT NULL AND pg2.cliente_id = pg.cliente_id)
            OR (pg.cpf IS NOT NULL AND pg.cpf <> '' AND pg2.cpf = pg.cpf)))
     AND NOT EXISTS (SELECT 1 FROM whatsapp_cobrancas w WHERE w.empresa_id = pg.empresa_id AND w.pagamento_id = pg.id AND w.etapa = ?)
   ORDER BY pg.expira_em LIMIT 50`;

async function reservar(empresaId, pagamentoId, etapa, telefone, status) {
  const [r] = await db.query("INSERT IGNORE INTO whatsapp_cobrancas (empresa_id, pagamento_id, etapa, telefone, status) VALUES (?, ?, ?, ?, ?)", [empresaId, pagamentoId, etapa, telefone || null, status]);
  return r.affectedRows > 0;
}

async function processarEmpresa({ empresaId, ren }, dormirFn) {
  if (!(await temRecurso(empresaId, "whatsapp"))) return 0;
  if (!(await instanciaConectada(empresaId))) return 0;
  const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);
  let enviados = 0;
  const telefonesRodada = new Set();
  for (const etapa of ren.dias) {
    if (enviados >= MAX_POR_RODADA) break;
    const [candidatos] = await db.query(SQL_CANDIDATOS, [empresaId, etapa, etapa + JANELA_DIAS, etapa]);
    for (const c of candidatos) {
      if (enviados >= MAX_POR_RODADA) break;
      let lead = null;
      if (c.cliente_id) [[lead]] = await db.query("SELECT id, nome, telefone, whatsapp_optout FROM leads WHERE id = ? AND empresa_id = ?", [c.cliente_id, empresaId]);
      if (!lead && c.cpf) {
        const cpf = String(c.cpf).replace(/\D/g, "");
        if (cpf.length === 11) [[lead]] = await db.query(
          "SELECT id, nome, telefone, whatsapp_optout FROM leads WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ? ORDER BY id LIMIT 1", [empresaId, cpf]);
      }
      if (lead && Number(lead.whatsapp_optout) === 1) { await reservar(empresaId, c.id, etapa, null, "ignorada"); continue; }
      const telefone = normalizarTelefone(c.telefone || lead?.telefone);
      if (!telefone) { await reservar(empresaId, c.id, etapa, null, "ignorada"); continue; }
      if (telefonesRodada.has(telefone)) continue; // tenta de novo na proxima rodada
      const [recente] = await db.query("SELECT id FROM whatsapp_cobrancas WHERE empresa_id = ? AND telefone = ? AND status = 'enviada' AND enviado_em >= DATE_SUB(NOW(), INTERVAL 20 HOUR) LIMIT 1", [empresaId, telefone]);
      if (recente.length) continue; // no maximo 1 lembrete por telefone a cada 20 h
      if (!(await reservar(empresaId, c.id, etapa, telefone, "enviada"))) continue;
      telefonesRodada.add(telefone);
      const link = comCupom(await linkPlanosDoCliente(empresaId, { clienteId: lead?.id || c.cliente_id, nasId: c.nas_id }) || "", ren.cupom);
      const mensagem = renderTemplate(ren.template, { nome: primeiroNome(lead?.nome), plano: c.nome_plano || "", link, empresa: emp?.nome || "" }).trim();
      try {
        await enviarMensagemEstrita(telefone, mensagem, empresaId);
        await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "renovacao", referencia_id: c.id, status: "ok" });
      } catch (err) {
        const msg = String(err.response?.data?.message || err.message || "Erro ao enviar").slice(0, 500);
        await db.query("UPDATE whatsapp_cobrancas SET status = 'erro' WHERE empresa_id = ? AND pagamento_id = ? AND etapa = ?", [empresaId, c.id, etapa]).catch(() => {});
        await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "renovacao", referencia_id: c.id, status: "erro", erro_msg: msg });
      }
      enviados++;
      if (enviados < MAX_POR_RODADA) await dormirFn(intervalo());
    }
  }
  return enviados;
}

async function renovacaoWhatsapp(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    let total = 0;
    for (const e of await empresasComRenovacao()) {
      try { total += await processarEmpresa(e, opts.dormir || dormirPadrao); }
      catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.error(`[renovacao] empresa ${e.empresaId}:`, err.message); }
    }
    return { enviados: total };
  } finally {
    emExecucao = false;
  }
}

module.exports = renovacaoWhatsapp;

if (require.main === module) {
  renovacaoWhatsapp().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
