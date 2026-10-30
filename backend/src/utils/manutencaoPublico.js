// Publico de uma manutencao: clientes (lead com CPF + telefone) que usaram o equipamento nos ultimos N dias.
// Sem equipamento = qualquer equipamento da empresa. Fora quem pediu para nao receber (opt-out + lista nao perturbe).
const { normalizarTelefone } = require("../services/whatsappNotify");
const naoPerturbe = require("./naoPerturbe");

const MAX_DESTINATARIOS = 500;

async function selecionarPublico(db, empresaId, equipamentoId, janelaDias = 30) {
  const dias = Math.min(365, Math.max(1, parseInt(janelaDias, 10) || 30));
  const params = [empresaId, empresaId, dias];
  let filtroNas;
  if (equipamentoId) {
    filtroNas = "ra.nasipaddress IN (SELECT m.ip FROM mikrotiks m WHERE m.id = ? AND m.empresa_id = ?)";
    params.push(equipamentoId, empresaId);
  } else {
    filtroNas = "ra.nasipaddress IN (SELECT m.ip FROM mikrotiks m WHERE m.empresa_id = ?)";
    params.push(empresaId);
  }
  const [rows] = await db.query(
    `SELECT l.id, l.nome, l.telefone FROM leads l
      WHERE l.empresa_id = ? AND l.telefone IS NOT NULL AND l.telefone <> '' AND l.cpf IS NOT NULL AND l.cpf <> ''
        AND l.whatsapp_optout = 0 AND l.status <> 'descartado'
        AND EXISTS (
          SELECT 1 FROM radius_users ru JOIN radacct ra
            ON ra.username COLLATE utf8mb4_unicode_ci = ru.username COLLATE utf8mb4_unicode_ci
          WHERE ru.empresa_id = ? AND ra.acctstarttime >= DATE_SUB(NOW(), INTERVAL ? DAY) AND ${filtroNas}
            AND ru.username COLLATE utf8mb4_unicode_ci = REPLACE(REPLACE(REPLACE(l.cpf, '.', ''), '-', ''), ' ', '') COLLATE utf8mb4_unicode_ci
        )
      ORDER BY l.id ASC LIMIT ${MAX_DESTINATARIOS * 2}`,
    params
  );
  const candidatos = [];
  let invalidos = 0;
  for (const r of rows) {
    const tel = normalizarTelefone(r.telefone);
    if (!tel) { invalidos++; continue; }
    candidatos.push({ lead_id: r.id, nome: r.nome || null, telefone: tel });
  }
  const bloqueados = await naoPerturbe.bloqueados(empresaId, candidatos.map((c) => c.telefone));
  const vistos = new Set();
  const destinatarios = [];
  let duplicados = 0, bloqueadosN = 0;
  for (const c of candidatos) {
    if (bloqueados.has(naoPerturbe.fim10(c.telefone))) { bloqueadosN++; continue; }
    if (vistos.has(c.telefone)) { duplicados++; continue; }
    vistos.add(c.telefone);
    if (destinatarios.length < MAX_DESTINATARIOS) destinatarios.push(c);
  }
  return { destinatarios, invalidos, duplicados, bloqueados: bloqueadosN, limite: MAX_DESTINATARIOS, excedeu: vistos.size > MAX_DESTINATARIOS };
}

module.exports = { MAX_DESTINATARIOS, selecionarPublico };
