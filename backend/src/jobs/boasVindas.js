// Rede de seguranca das mensagens da plataforma a empresas novas. Cron a cada 10 min (server.js).
//  1. Boas-vindas que nao saiu no cadastro (WhatsApp da plataforma desconectado, etc.): empresas criadas nas
//     ultimas 24 h com boas_vindas_em NULL (ligar o recurso nunca dispara o historico antigo).
//  2. Lembrete de ativacao (opcional, desligado por padrao): 48 h-7 d depois do cadastro, sem equipamento.
const db = require("../../db");
const { enviarBoasVindas, enviarLembreteAtivacao, obterConfig, plataformaId } = require("../services/boasVindasEmpresa");
const { temColuna } = require("../utils/schemaCache");

const MAX_POR_RODADA = 5;
const INTERVALO_MS = [3000, 8000];
let emExecucao = false;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervalo = () => INTERVALO_MS[0] + Math.floor(Math.random() * (INTERVALO_MS[1] - INTERVALO_MS[0]));

async function boasVindas() {
  if (emExecucao) return;
  emExecucao = true;
  try {
    if (!(await temColuna("empresas", "boas_vindas_em"))) return;
    const cfg = await obterConfig();
    let enviadas = 0;

    if (cfg.ativo) {
      const [pend] = await db.query(
        `SELECT id FROM empresas WHERE boas_vindas_em IS NULL AND id <> ? AND criado_em >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          ORDER BY id LIMIT ${MAX_POR_RODADA}`, [plataformaId()]);
      for (const e of pend) {
        const r = await enviarBoasVindas(e.id);
        // Sem WhatsApp da plataforma nao adianta insistir nas demais nesta rodada.
        if (r.motivo === "whatsapp_desconectado" || r.motivo === "desligada") break;
        if (r.ok) { enviadas++; await dormir(intervalo()); }
      }
    }

    if (cfg.lembrete_ativacao.ativo && enviadas < MAX_POR_RODADA) {
      const [cand] = await db.query(
        `SELECT e.id FROM empresas e
          WHERE e.id <> ? AND e.ativo = 1 AND e.criado_em <= DATE_SUB(NOW(), INTERVAL 48 HOUR) AND e.criado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND NOT EXISTS (SELECT 1 FROM mikrotiks m WHERE m.empresa_id = e.id)
          ORDER BY e.id LIMIT ${MAX_POR_RODADA}`, [plataformaId()]);
      for (const e of cand) {
        if (enviadas >= MAX_POR_RODADA) break;
        const r = await enviarLembreteAtivacao(e.id);
        if (r.motivo === "whatsapp_desconectado") break;
        if (r.ok) { enviadas++; await dormir(intervalo()); }
      }
    }
  } catch (err) {
    console.error("[boasVindas] erro:", err.message);
  } finally {
    emExecucao = false;
  }
}

module.exports = boasVindas;

if (require.main === module) {
  boasVindas().then(() => process.exit(0));
}
