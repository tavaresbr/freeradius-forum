// Padroes aplicados a TODO equipamento MikroTik (assistente do hotspot e "Aplicar padroes em todos").
//
// - keepaliveTimeout: o padrao de fabrica do user profile "default" e' 2 min, o que derruba o cliente
//   quando o celular apaga a tela (Lost-Service no radacct). 1h = duracao do plano gratis.
// - radiusInterimUpdate: com "received" o roteador so manda atualizacao se o servidor pedir; se o
//   Accounting-Start se perder, a sessao nunca aparece em Sessoes Ativas. A cada 5 min o FreeRADIUS
//   cria/atualiza a linha do radacct.
// - radiusTimeout: tolerancia ao primeiro pacote pela VPN depois de ociosa.
const HOTSPOT_PADROES = {
  keepaliveTimeout: "1h",
  idleTimeout: "none",
  radiusInterimUpdate: "5m",
  radiusTimeout: "3s",
};

module.exports = { HOTSPOT_PADROES };
