// Link da pagina de planos do portal (o pagamento em si segue pelo fluxo seguro PIX/cartao do portal).
const db = require("../../db");
const { portalHostDaEmpresa } = require("./dominioPortal");

/** https://<host>/planos-cliente?empresa_id=&mikrotik_id=&cliente_id= (ou null sem host/equipamento). */
function montarLinkPlanos(host, { empresaId, mikrotikId, clienteId }) {
  if (!host || !empresaId || !mikrotikId) return null;
  const p = new URLSearchParams({ empresa_id: String(empresaId), mikrotik_id: String(mikrotikId) });
  if (clienteId) p.set("cliente_id", String(clienteId));
  return `https://${host}/planos-cliente?${p.toString()}`;
}

/** Equipamento (da empresa) que o cliente usou; sem ele, o primeiro da empresa. */
async function equipamentoDoCliente(empresaId, nasId) {
  if (nasId) {
    const [[m]] = await db.query("SELECT id FROM mikrotiks WHERE id = ? AND empresa_id = ?", [nasId, empresaId]);
    if (m) return m.id;
  }
  const [[primeiro]] = await db.query("SELECT id FROM mikrotiks WHERE empresa_id = ? ORDER BY id LIMIT 1", [empresaId]);
  return primeiro?.id || null;
}

async function linkPlanosDoCliente(empresaId, { clienteId, nasId }) {
  const host = await portalHostDaEmpresa(empresaId);
  const mikrotikId = await equipamentoDoCliente(empresaId, nasId);
  return montarLinkPlanos(host, { empresaId, mikrotikId, clienteId });
}

module.exports = { montarLinkPlanos, linkPlanosDoCliente };
