// Padroes aplicados a TODO equipamento MikroTik (assistente do hotspot e "Aplicar padroes em todos").
//
// - keepaliveTimeout: o padrao de fabrica do user profile "default" e' 2 min, o que derruba o cliente
//   quando o celular apaga a tela (Lost-Service no radacct). 30 min cobre a tela apagada sem manter por muito tempo a sessao de quem saiu do alcance.
// - radiusInterimUpdate: com "received" o roteador so manda atualizacao se o servidor pedir; se o
//   Accounting-Start se perder, a sessao nunca aparece em Sessoes Ativas. A cada 5 min o FreeRADIUS
//   cria/atualiza a linha do radacct.
// - addressesPerMac: 1 IP por MAC no hotspot (um aparelho nao consome varios IPs do pool).
// - dhcpLeaseTime: lease explicito (o padrao do RouterOS e' 30 min).
// - radiusTimeout: tolerancia ao primeiro pacote pela VPN depois de ociosa.
const HOTSPOT_PADROES = {
  keepaliveTimeout: "30m",
  idleTimeout: "none",
  radiusInterimUpdate: "5m",
  radiusTimeout: "3s",
  addressesPerMac: "1",
  dhcpLeaseTime: "1h",
};

module.exports = { HOTSPOT_PADROES };
