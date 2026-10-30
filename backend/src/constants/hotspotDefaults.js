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

// on-logout opcional (assistente): ao fim da sessao remove o lease DHCP dinamico e a associacao Wi-Fi do
// aparelho para ele reconectar e o sistema reabrir o portal. Espera e so age se o MAC nao tiver outra
// sessao ativa (re-login legitimo, ex. trial PIX -> pago, nao pode derrubar o cliente).
const ON_LOGOUT_HOTSPOT = {
  marcador: "# apex-on-logout",
  espera: "5s",
};

function scriptOnLogout() {
  return [
    ON_LOGOUT_HOTSPOT.marcador,
    `:delay ${ON_LOGOUT_HOTSPOT.espera}`,
    ':local mac [:tostr $"mac-address"]',
    ':local ip [:tostr $address]',
    ':if ([:len [/ip hotspot active find where mac-address=$mac]] = 0) do={',
    '  :do { /ip dhcp-server lease remove [find where address=$ip and mac-address=$mac and dynamic=yes] } on-error={ }',
    '  :do { /interface wireless registration-table remove [find where mac-address=$mac] } on-error={ }',
    '  :do { /interface wifi registration-table remove [find where mac-address=$mac] } on-error={ }',
    '}',
  ].join("\n");
}

module.exports = { HOTSPOT_PADROES, DNS_SEGURO, BRIDGE_HOTSPOT, ON_LOGOUT_HOTSPOT, scriptOnLogout };
