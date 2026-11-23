// Cria um envio de aviso (fila de promocoes, tipo 'aviso') para os clientes que usaram um equipamento.
// Usado por manutencoes e alertas tecnicos; o worker jobs/enviaPromocoes.js entrega com ritmo humano.
const pub = require("../utils/manutencaoPublico");

/** Retorna o id do envio, ou null se nao ha ninguem para avisar. `filtros` vai em filtros_json (ex.: { origem, ... }). */
async function criarEnvioAviso(db, { empresaId, equipamentoId, janelaDias = 30, nome, mensagem, filtros }) {
  const sel = await pub.selecionarPublico(db, empresaId, equipamentoId, janelaDias);
  if (!sel.destinatarios.length) return null;
  const [r] = await db.query(
    `INSERT INTO promocao_envios (empresa_id, nome, tipo, mensagem, filtros_json, status, total, iniciado_em)
     VALUES (?, ?, 'aviso', ?, ?, 'em_andamento', ?, NOW())`,
    [empresaId, String(nome).slice(0, 150), mensagem, JSON.stringify(filtros || {}), sel.destinatarios.length]
  );
  // Fase 2: o aviso sai pelo numero padrao dos envios automaticos (so grava se a coluna existe e ha numero extra)
  try {
    const numeroId = await require("../utils/numeroEnvio").numeroPadrao(empresaId);
    if (numeroId > 0 && await require("../utils/schemaCache").temColuna("promocao_envios", "numero_id")) {
      await db.query("UPDATE promocao_envios SET numero_id = ? WHERE id = ? AND empresa_id = ?", [numeroId, r.insertId, empresaId]);
    }
  } catch (err) { console.warn("[avisoClientes] numero padrao ignorado:", err.message); }
  await db.query(
    "INSERT INTO promocao_destinatarios (envio_id, empresa_id, lead_id, telefone, nome) VALUES ?",
    [sel.destinatarios.map((d) => [r.insertId, empresaId, d.lead_id, d.telefone, d.nome])]
  );
  return r.insertId;
}

module.exports = { criarEnvioAviso };
