// Avisos de manutencao programada por WhatsApp. Roda a cada 5 min (cron do server.js).
// Para cada manutencao agendada/em andamento com "avisar clientes": quando uma etapa fica devida (X min antes do inicio,
// ou apos o fim) reserva a etapa (UNIQUE manutencao+etapa) e cria UM envio na fila de promocoes (tipo 'aviso'), que o worker
// jobs/enviaPromocoes.js entrega com ritmo humano. Fora do horario de silencio ("manutencao") so adia: nada e reservado.
const db = require("../../db");
const { temRecurso } = require("../utils/assinatura");
const m = require("../utils/manutencao");
const pub = require("../utils/manutencaoPublico");
const naoPerturbe = require("../utils/naoPerturbe");

let emExecucao = false;

async function criarEnvio(mt, etapa, nomeEquipamento) {
  const modelo = etapa === "fim" ? (mt.mensagem_fim || m.MENSAGEM_FIM_PADRAO) : mt.mensagem;
  const mensagem = m.renderizarMensagem(modelo, { inicio: mt.inicio_em, fim: mt.fim_em, equipamento: nomeEquipamento });
  const sel = await pub.selecionarPublico(db, mt.empresa_id, mt.equipamento_id, mt.janela_dias);
  if (!sel.destinatarios.length) return null;
  const [r] = await db.query(
    `INSERT INTO promocao_envios (empresa_id, nome, tipo, mensagem, filtros_json, status, total, iniciado_em)
     VALUES (?, ?, 'aviso', ?, ?, 'em_andamento', ?, NOW())`,
    [mt.empresa_id, `Manutenção: ${mt.titulo}`.slice(0, 150), mensagem, JSON.stringify({ origem: "manutencao", manutencao_id: mt.id, etapa }), sel.destinatarios.length]
  );
  await db.query(
    "INSERT INTO promocao_destinatarios (envio_id, empresa_id, lead_id, telefone, nome) VALUES ?",
    [sel.destinatarios.map((d) => [r.insertId, mt.empresa_id, d.lead_id, d.telefone, d.nome])]
  );
  return r.insertId;
}

async function processar(mt) {
  const [feitasRows] = await db.query("SELECT etapa FROM manutencao_avisos WHERE manutencao_id = ?", [mt.id]);
  const devidas = m.etapasDevidas({ ...mt, antecedencias: (() => { try { return JSON.parse(mt.antecedencias); } catch { return []; } })() },
    Number(mt.min_ate_inicio), Number(mt.min_ate_fim), feitasRows.map((r) => r.etapa));
  if (devidas.length && (await naoPerturbe.emSilencio(mt.empresa_id, "manutencao"))) return 0; // adia
  if (devidas.length && !(await temRecurso(mt.empresa_id, "whatsapp"))) return 0;
  let criados = 0;
  for (const e of devidas) {
    if (e.startsWith("pula:")) { await db.query("INSERT IGNORE INTO manutencao_avisos (manutencao_id, empresa_id, etapa) VALUES (?, ?, ?)", [mt.id, mt.empresa_id, e.slice(5)]); continue; }
    const [claim] = await db.query("INSERT IGNORE INTO manutencao_avisos (manutencao_id, empresa_id, etapa) VALUES (?, ?, ?)", [mt.id, mt.empresa_id, e]);
    if (!claim.affectedRows) continue; // outra rodada/processo ja reservou
    try {
      const envioId = await criarEnvio(mt, e, mt.equipamento_nome);
      if (envioId) { await db.query("UPDATE manutencao_avisos SET envio_id = ? WHERE manutencao_id = ? AND etapa = ?", [envioId, mt.id, e]); criados++; }
    } catch (err) {
      await db.query("DELETE FROM manutencao_avisos WHERE manutencao_id = ? AND etapa = ?", [mt.id, e]).catch(() => {}); // devolve a reserva: tenta de novo
      throw err;
    }
  }
  return criados;
}

async function manutencoes() {
  if (emExecucao) return { pulado: true };
  emExecucao = true;
  try {
    // Estados: agendada -> em_andamento (inicio) -> concluida (fim e, se pedido, aviso final ja reservado ou vencido)
    await db.query("UPDATE manutencoes SET status = 'em_andamento' WHERE status = 'agendada' AND inicio_em <= NOW() AND fim_em > NOW()");
    const [rows] = await db.query(
      `SELECT mt.*, mk.nome AS equipamento_nome, TIMESTAMPDIFF(MINUTE, NOW(), mt.inicio_em) AS min_ate_inicio, TIMESTAMPDIFF(MINUTE, NOW(), mt.fim_em) AS min_ate_fim
         FROM manutencoes mt LEFT JOIN mikrotiks mk ON mk.id = mt.equipamento_id AND mk.empresa_id = mt.empresa_id
        WHERE mt.status IN ('agendada','em_andamento') AND mt.avisar_clientes = 1 ORDER BY mt.inicio_em LIMIT 200`
    );
    let total = 0;
    for (const mt of rows) {
      try { total += await processar(mt); }
      catch (err) { console.error(`[manutencoes] ${mt.id}:`, err.message); }
    }
    // Encerra as que passaram do fim (6 h de folga para o aviso final)
    await db.query("UPDATE manutencoes SET status = 'concluida' WHERE status IN ('agendada','em_andamento') AND fim_em < DATE_SUB(NOW(), INTERVAL 6 HOUR)");
    return { envios: total };
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") console.error("[manutencoes]", err.message);
    return { envios: 0 };
  } finally {
    emExecucao = false;
  }
}

module.exports = manutencoes;

if (require.main === module) {
  manutencoes().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
