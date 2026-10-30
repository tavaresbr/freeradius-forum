// Padroes aplicados a TODO equipamento MikroTik (assistente do hotspot e "Aplicar padroes em todos").
//
// - keepaliveTimeout: o padrao de fabrica do user profile "default" e' 2 min, o que derruba o cliente
//   quando o celular apaga a tela (Lost-Service no radacct). 30 min cobre a tela apagada sem manter por muito tempo a sessao de quem saiu do alcance.
// - radiusInterimUpdate: com "received" o roteador so manda atualizacao se o servidor pedir; se o
//   Accounting-Start se perder, a sessao nunca aparece em Sessoes Ativas. A cada 5 min o FreeRADIUS
//   cria/atualiza a linha do radacct.
// - addressesPerMac: 1 IP por MAC no hotspot (um aparelho nao consome varios IPs do pool).
// - dhcpLeaseTime: lease explicito (o padrao do RouterOS e' 30 min).
// - loginBy / macCookieTimeout: o aparelho que volta em ate 1 h reconecta sozinho (mac-cookie) sem passar
//   pelo portal; o RADIUS continua mandando (franquia, senha e Simultaneous-Use), entao Reject volta ao login.
// - radiusTimeout: tolerancia ao primeiro pacote pela VPN depois de ociosa.
const HOTSPOT_PADROES = {
  keepaliveTimeout: "30m",
  idleTimeout: "none",
  radiusInterimUpdate: "5m",
  radiusTimeout: "3s",
  addressesPerMac: "1",
  dhcpLeaseTime: "1h",
  loginBy: "http-chap,http-pap,mac-cookie",
  macCookieTimeout: "1h",
};

// DNS seguro (opcional por equipamento, escolhido no assistente): o DNS do roteador encaminha para o
// OpenDNS FamilyShield (bloqueia conteudo adulto) e o DHCP entrega o proprio gateway como DNS.
// Limite: cliente com DNS fixo ou DNS sobre HTTPS no navegador contorna o filtro.
const DNS_SEGURO = {
  servidores: "208.67.222.123,208.67.220.123",
  padrao: "8.8.8.8,1.1.1.1",
};

// Bridge opcional do hotspot (varias radios/portas na mesma rede de clientes), escolhida no assistente.
const BRIDGE_HOTSPOT = {
  nome: "bridge-hotspot",
  maxPortas: 12,
};

module.exports = { HOTSPOT_PADROES, DNS_SEGURO, BRIDGE_HOTSPOT };
