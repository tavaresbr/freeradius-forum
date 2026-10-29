// Aviso operacional (queda, manutencao): validacao, mensagem e selecao de quem esta conectado AGORA.
// Reaproveita a fila de promocoes (promocao_envios.tipo = 'aviso'). Respeita o opt-out ("SAIR") mesmo sendo aviso de servico.
const { renderTemplate, normalizarTelefone } = require("../services/whatsappNotify");

const MAX_NOME = 150;
const MAX_MENSAGEM = 1000;
const MAX_DESTINATARIOS = 500;

const primeiroNome = (n) => (String(n || "").trim().split(/\s+/)[0] || "").slice(0, 40);

/** Aviso nao leva o rodape "responda SAIR" de marketing. */
const montarMensagemAviso = (modelo, nome) => renderTemplate(String(modelo || "").trim(), { nome: primeiroNome(nome) || "cliente" });

function validarAviso(body) {
  const nome = String(body?.nome || "").trim() || "Aviso operacional";
  const mensagem = String(body?.mensagem || "").trim();
  if (nome.length > MAX_NOME) return { ok: false, erro: `O título deve ter no máximo ${MAX_NOME} caracteres` };
  if (!mensagem) return { ok: false, erro: "Escreva a mensagem do aviso" };
  if (mensagem.length > MAX_MENSAGEM) return { ok: false, erro: `A mensagem deve ter no máximo ${MAX_MENSAGEM} caracteres` };
  let equipamento_id = null;
  if (body?.equipamento_id !== undefined && body?.equipamento_id !== null && body?.equipamento_id !== "") {
    equipamento_id = Number(body.equipamento_id);
    if (!Number.isInteger(equipamento_id) || equipamento_id <= 0) return { ok: false, erro: "Equipamento inválido" };
  }
  return { ok: true, nome, mensagem, equipamento_id };
}

/**
 * Clientes (leads com CPF + telefone, sem opt-out e nao descartados) com sessao ABERTA agora no radacct.
 * equipamentoId (opcional) restringe a quem esta naquele equipamento (radacct.nasipaddress = mikrotiks.ip, da mesma empresa).
 * Telefone normalizado e deduplicado; maximo MAX_DESTINATARIOS.
 */
async function selecionarConectados(db, empresaId, equipamentoId) {
  const params = [empresaId, empresaId];
  let filtroEq = "";
  if (equipamentoId) {
    filtroEq = "AND ra.nasipaddress IN (SELECT m.ip FROM mikrotiks m WHERE m.id = ? AND m.empresa_id = ?)";
    params.push(equipamentoId, empresaId);
  }
  const [rows] = await db.query(
    `SELECT l.id, l.nome, l.telefone FROM leads l
      WHERE l.empresa_id = ? AND l.telefone IS NOT NULL AND l.telefone <> '' AND l.cpf IS NOT NULL AND l.cpf <> ''
        AND l.whatsapp_optout = 0 AND l.status <> 'descartado'
        AND EXISTS (
          SELECT 1 FROM radius_users ru JOIN radacct ra
            ON ra.username COLLATE utf8mb4_unicode_ci = ru.username COLLATE utf8mb4_unicode_ci
          WHERE ru.empresa_id = ? AND ra.acctstoptime IS NULL ${filtroEq}
            AND ru.username COLLATE utf8mb4_unicode_ci = REPLACE(REPLACE(REPLACE(l.cpf, '.', ''), '-', ''), ' ', '') COLLATE utf8mb4_unicode_ci
        )
      ORDER BY l.id ASC LIMIT ${MAX_DESTINATARIOS * 2}`,
    params
  );
  const vistos = new Set();
  const destinatarios = [];
  let invalidos = 0, duplicados = 0;
  for (const r of rows) {
    const tel = normalizarTelefone(r.telefone);
    if (!tel) { invalidos++; continue; }
    if (vistos.has(tel)) { duplicados++; continue; }
    vistos.add(tel);
    if (destinatarios.length < MAX_DESTINATARIOS) destinatarios.push({ lead_id: r.id, nome: r.nome || null, telefone: tel });
  }
  return { destinatarios, invalidos, duplicados, limite: MAX_DESTINATARIOS, excedeu: vistos.size > MAX_DESTINATARIOS };
}

module.exports = { MAX_DESTINATARIOS, MAX_MENSAGEM, montarMensagemAviso, validarAviso, selecionarConectados };
