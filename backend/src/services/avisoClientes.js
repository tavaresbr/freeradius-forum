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
  await db.query(
    "INSERT INTO promocao_destinatarios (envio_id, empresa_id, lead_id, telefone, nome) VALUES ?",
    [sel.destinatarios.map((d) => [r.insertId, empresaId, d.lead_id, d.telefone, d.nome])]
  );
  return r.insertId;
}

module.exports = { criarEnvioAviso };
