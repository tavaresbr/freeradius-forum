// Fila de promocoes por WhatsApp. Roda a cada minuto (cron do server.js).
// Por rodada: no maximo 1 promocao por empresa e LOTE mensagens, com intervalo aleatorio entre elas
// (ritmo humano reduz risco de banimento do numero). O estado vive no banco: restart do PM2 nao perde nada.
const db = require("../../db");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog } = require("../services/whatsappNotify");
const { montarMensagem } = require("../utils/promocaoWhatsapp");

const LOTE = 4;
const INTERVALO_MIN_MS = 8000;
const INTERVALO_MAX_MS = 20000;

let emExecucao = false; // evita duas rodadas ao mesmo tempo (uma rodada pode passar de 1 min)

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const intervaloAleatorio = () => INTERVALO_MIN_MS + Math.floor(Math.random() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS));

async function recontarEFechar(envio) {
  const [rows] = await db.execute(
    "SELECT status, COUNT(*) AS n FROM promocao_destinatarios WHERE envio_id = ? GROUP BY status",
    [envio.id]
  );
  const c = { enviado: 0, erro: 0, ignorado: 0, pendente: 0 };
  for (const r of rows) c[r.status] = Number(r.n);
  await db.execute(
    "UPDATE promocao_envios SET enviados = ?, falhas = ?, ignorados = ? WHERE id = ?",
    [c.enviado, c.erro, c.ignorado, envio.id]
  );
  if (c.pendente === 0) {
    // So conclui se ainda esta em andamento (nao sobrescreve pausa/cancelamento feitos no meio da rodada)
    await db.execute(
      "UPDATE promocao_envios SET status = 'concluida', concluido_em = NOW() WHERE id = ? AND status = 'em_andamento'",
      [envio.id]
    );
  }
}

async function processarEnvio(envio, { dormirFn }) {
  if (!(await instanciaConectada(envio.empresa_id))) {
    // Sem WhatsApp conectado: pausa em vez de queimar a fila com erros. O admin retoma na tela.
    await db.execute("UPDATE promocao_envios SET status = 'pausada' WHERE id = ? AND status = 'em_andamento'", [envio.id]);
    console.warn(`[promocoes] envio ${envio.id} pausado: WhatsApp da empresa ${envio.empresa_id} desconectado`);
    return;
  }

  const [pendentes] = await db.execute(
    `SELECT id, lead_id, telefone, nome FROM promocao_destinatarios
      WHERE envio_id = ? AND status = 'pendente' ORDER BY id ASC LIMIT ${LOTE}`,
    [envio.id]
  );

  for (let i = 0; i < pendentes.length; i++) {
    // Pausa/cancelamento feitos durante a rodada valem na proxima mensagem
    const [[atual]] = await db.execute("SELECT status FROM promocao_envios WHERE id = ?", [envio.id]);
    if (!atual || atual.status !== "em_andamento") break;

    const d = pendentes[i];

    // Quem pediu para sair depois de a fila ser criada nao recebe
    if (d.lead_id) {
      const [[lead]] = await db.execute(
        "SELECT whatsapp_optout FROM leads WHERE id = ? AND empresa_id = ?",
        [d.lead_id, envio.empresa_id]
      );
      if (!lead || Number(lead.whatsapp_optout) === 1) {
        await db.execute(
          "UPDATE promocao_destinatarios SET status = 'ignorado', erro_msg = ? WHERE id = ?",
          [lead ? "Pediu para não receber" : "Cadastro removido", d.id]
        );
        continue;
      }
    }

    const mensagem = montarMensagem(envio.mensagem, d.nome);
    try {
      await enviarMensagemEstrita(d.telefone, mensagem, envio.empresa_id);
      await db.execute("UPDATE promocao_destinatarios SET status = 'enviado', enviado_em = NOW() WHERE id = ?", [d.id]);
      await gravarLog({ empresa_id: envio.empresa_id, telefone: d.telefone, mensagem, contexto_tipo: "promocao", referencia_id: envio.id, status: "ok" });
    } catch (err) {
      const msg = String(err.response?.data?.message || err.message || "Erro ao enviar").slice(0, 500);
      await db.execute("UPDATE promocao_destinatarios SET status = 'erro', erro_msg = ? WHERE id = ?", [msg, d.id]);
      await gravarLog({ empresa_id: envio.empresa_id, telefone: d.telefone, mensagem, contexto_tipo: "promocao", referencia_id: envio.id, status: "erro", erro_msg: msg });
    }

    if (i < pendentes.length - 1) await dormirFn(intervaloAleatorio());
  }

  await recontarEFechar(envio);
}

// opts.dormir permite aos testes nao esperar de verdade
async function enviaPromocoes(opts = {}) {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  const dormirFn = opts.dormir || dormir;
  try {
    const [envios] = await db.execute(
      "SELECT id, empresa_id, mensagem FROM promocao_envios WHERE status = 'em_andamento' ORDER BY id ASC"
    );
    const empresasAtendidas = new Set();
    for (const envio of envios) {
      if (empresasAtendidas.has(envio.empresa_id)) continue; // 1 promocao por empresa por rodada
      empresasAtendidas.add(envio.empresa_id);
      try {
        await processarEnvio(envio, { dormirFn });
      } catch (err) {
        console.error(`[promocoes] erro no envio ${envio.id}:`, err.message);
      }
    }
    return { envios: envios.length };
  } finally {
    emExecucao = false;
  }
}

module.exports = enviaPromocoes;

if (require.main === module) {
  enviaPromocoes().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
