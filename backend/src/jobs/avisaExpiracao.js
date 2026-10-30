// Aviso "seu tempo esta acabando" por WhatsApp. Roda a cada 2 min (cron do server.js).
// Por empresa com o aviso LIGADO (config_json.aviso_expiracao, desligado por padrao): sessoes abertas cujo tempo
// restante (mesma conta do sqlcounter / tela Sessoes Ativas) e' <= N minutos. Telefone so pelo cadastro do CPF
// (username = CPF; nunca por MAC). 1 aviso por ciclo de liberacao (UNIQUE empresa+username+liberado_em).
const naoPerturbe = require("../utils/naoPerturbe");
const db = require("../../db");
const { erroEvolution } = require("../utils/erroEvolution");
const { temRecurso } = require("../utils/assinatura");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog, normalizarTelefone, renderTemplate } = require("../services/whatsappNotify");
const { mesclarComPadrao } = require("../utils/avisoExpiracao");
const { montarLinkPlanos } = require("../utils/linkPlanos");
const { portalHostDaEmpresa } = require("../utils/dominioPortal");

const MAX_POR_RODADA = 5; // por empresa (ritmo humano; o resto fica para a proxima rodada)
const INTERVALO_MS = [3000, 8000];

let emExecucao = false;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "cliente";

const SQL_SESSOES = `
  SELECT ru.username, ru.liberado_em, ru.nas_id, p.nome AS plano, t.restante
    FROM (
      SELECT ru0.username,
             (SELECT GREATEST(CAST(rc.value AS SIGNED) - (
                SELECT COALESCE(SUM(IF(r2.acctstoptime IS NULL,
                         UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r2.acctstarttime), r2.acctsessiontime)), 0)
                  FROM radacct r2
                 WHERE r2.username COLLATE utf8mb4_unicode_ci = ru0.username COLLATE utf8mb4_unicode_ci
                   AND r2.acctstarttime >= COALESCE(ru0.liberado_em, '1970-01-01 00:00:00')
              ), 0)
                FROM radcheck rc
               WHERE rc.username COLLATE utf8mb4_unicode_ci = ru0.username COLLATE utf8mb4_unicode_ci
                 AND rc.attribute = 'Max-All-Session' LIMIT 1) AS restante
        FROM radius_users ru0
       WHERE ru0.empresa_id = ?
         AND EXISTS (SELECT 1 FROM radacct ra WHERE ra.acctstoptime IS NULL
                      AND ra.username COLLATE utf8mb4_unicode_ci = ru0.username COLLATE utf8mb4_unicode_ci)
    ) t
    JOIN radius_users ru ON ru.username = t.username AND ru.empresa_id = ?
    LEFT JOIN planos p ON p.id = ru.plano_id
   WHERE t.restante IS NOT NULL AND t.restante > 0 AND t.restante <= ?
   LIMIT 50`;

async function empresasComAviso() {
  const [rows] = await db.query("SELECT empresa_id, config_json FROM empresa_configs WHERE config_type = 'whatsapp' AND config_json LIKE '%aviso_expiracao%'");
  const out = [];
  for (const r of rows) {
    try {
      const cfg = typeof r.config_json === "string" ? JSON.parse(r.config_json) : r.config_json;
      const aviso = mesclarComPadrao(cfg?.aviso_expiracao);
      if (cfg?.aviso_expiracao && aviso.ativo) out.push({ empresaId: r.empresa_id, aviso });
    } catch { /* config ilegivel: ignora */ }
  }
  return out;
}

async function processarEmpresa({ empresaId, aviso }, dormirFn) {
  if (!(await temRecurso(empresaId, "whatsapp"))) return 0;
  if (await naoPerturbe.emSilencio(empresaId, "aviso_expiracao")) return 0;
  if (!(await instanciaConectada(empresaId))) return 0;
  const [sessoes] = await db.query(SQL_SESSOES, [empresaId, empresaId, aviso.minutos * 60]);
  const host = await portalHostDaEmpresa(empresaId);
  const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);
  let enviados = 0;
  for (const s of sessoes) {
    if (enviados >= MAX_POR_RODADA) break;
    if (!/^\d{11}$/.test(String(s.username))) continue; // so CPF: MAC/voucher/pix nao tem telefone confiavel
    const [[lead]] = await db.query(
      `SELECT id, nome, telefone, whatsapp_optout FROM leads
        WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ? ORDER BY id LIMIT 1`,
      [empresaId, s.username]
    );
    if (!lead || Number(lead.whatsapp_optout) === 1) continue;
    const telefone = normalizarTelefone(lead.telefone);
    if (!telefone) continue;
    if (await naoPerturbe.estaBloqueado(empresaId, telefone)) continue;
    // Reserva o aviso deste ciclo (idempotente: outra rodada/processo nao repete)
    const [claim] = await db.query(
      "INSERT IGNORE INTO whatsapp_avisos_expiracao (empresa_id, username, liberado_em) VALUES (?, ?, COALESCE(?, '1970-01-01 00:00:00'))",
      [empresaId, s.username, s.liberado_em]
    );
    if (!claim.affectedRows) continue;
    const minutos = Math.max(1, Math.ceil(Number(s.restante) / 60));
    const link = montarLinkPlanos(host, { empresaId, mikrotikId: s.nas_id, clienteId: lead.id }) || "";
    const mensagem = renderTemplate(aviso.template, { nome: primeiroNome(lead.nome), minutos: String(minutos), link, plano: s.plano || "", empresa: emp?.nome || "" }).trim();
    try {
      await enviarMensagemEstrita(telefone, mensagem, empresaId);
      await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "aviso_expiracao", status: "ok" });
    } catch (err) {
      const msg = String(erroEvolution(err)).slice(0, 500);
      await gravarLog({ empresa_id: empresaId, telefone, mensagem, contexto_tipo: "aviso_expiracao", status: "erro", erro_msg: msg });
    }
    enviados++;
    if (enviados < MAX_POR_RODADA) await dormirFn(intervalo());
  }
  return enviados;
}

// opts.dormir permite aos testes nao esperar de verdade
async function avisaExpiracao(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    let total = 0;
    for (const e of await empresasComAviso()) {
      try { total += await processarEmpresa(e, opts.dormir || dormir); }
      catch (err) { if (err.code !== "ER_NO_SUCH_TABLE") console.error(`[aviso-expiracao] empresa ${e.empresaId}:`, err.message); }
    }
    return { enviados: total };
  } finally {
    emExecucao = false;
  }
}

module.exports = avisaExpiracao;

if (require.main === module) {
  avisaExpiracao().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
