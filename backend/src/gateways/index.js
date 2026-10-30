/**
 * Factory da camada de gateways (Fase 4).
 *
 *   getDriver("mikrotik")          -> MikrotikDriver
 *   getDriver(gatewayRow)          -> driver conforme gatewayRow.tipo
 *
 * Aceita tanto uma string `tipo` quanto a linha da tabela `mikrotiks` (que tem
 * a coluna `tipo` a partir da migration 019). Quando recebe a linha, ela e'
 * passada ao construtor do driver como config do gateway.
 *
 * Omada e UniFi entram na Fase 4B. O require dos drivers e' leve: o UnifiDriver
 * faz require LAZY de `node-unifi` (so dentro dos metodos), entao carregar este
 * modulo nunca quebra o boot mesmo sem a dependencia instalada.
 */
const GatewayDriver = require("./GatewayDriver");
const MikrotikDriver = require("./MikrotikDriver");
const OmadaDriver = require("./OmadaDriver");
const UnifiDriver = require("./UnifiDriver");
const GrandstreamDriver = require("./GrandstreamDriver");
const IntelbrasDriver = require("./IntelbrasDriver");

const DRIVERS = {
  mikrotik: MikrotikDriver,
  omada: OmadaDriver,   // Fase 4B
  unifi: UnifiDriver,   // Fase 4B
  grandstream: GrandstreamDriver,
  intelbras: IntelbrasDriver,
};

/**
 * @param {string|Object} arg - tipo do gateway ("mikrotik"|"omada"|"unifi") ou
 *   a linha da tabela `mikrotiks` (usa arg.tipo).
 * @returns {GatewayDriver}
 */
function getDriver(arg) {
  const gateway = (arg && typeof arg === "object") ? arg : {};
  const tipo = (typeof arg === "string" ? arg : gateway.tipo) || "mikrotik";

  const DriverClass = DRIVERS[tipo];
  if (!DriverClass) {
    throw new Error(`Gateway tipo '${tipo}' ainda nao suportado (drivers disponiveis: ${Object.keys(DRIVERS).join(", ")})`);
  }
  return new DriverClass(gateway);
}

module.exports = { getDriver, GatewayDriver, MikrotikDriver, OmadaDriver, UnifiDriver, GrandstreamDriver, IntelbrasDriver };
