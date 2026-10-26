/**
 * Trecho "Wi-Fi" do script de instalacao rapida do roteador (RouterOS).
 * (`[[:parse "..."]]` nao executa nada no RouterOS: o codigo precisa de `:local f [:parse ...]; $f`.)
 * Cada comando em linha propria; so o ramo `wifi` (hAP ax, RouterOS 7.13+) usa [:parse]
 * para que um modelo sem /interface wifi nao quebre a linha. O ramo `wireless`
 * (hAP ac/lite, RB951 etc.: /interface wireless, wlan1) usa comandos diretos.
 * Colchetes viram \5B/\5D (hex) porque dentro de aspas o RouterOS os trataria como substituicao.
 * O SSID ja vem sanitizado de utils/ssid (sem aspas, $, [, ], ?, \).
 */
const emString = (codigo) =>
  codigo.replace(/\[/g, "\\5B").replace(/\]/g, "\\5D").replace(/"/g, '\\"');

function linhasWifi(ssid) {
  const wifi = [
    `:if ([:len [/interface wifi configuration find name=cfg-hotspot]]=0) do={ /interface wifi configuration add name=cfg-hotspot mode=ap country=Brazil ssid="${ssid}" datapath.client-isolation=yes } else={ /interface wifi configuration set [find name=cfg-hotspot] ssid="${ssid}" datapath.client-isolation=yes }`,
    `/interface wifi set [find] configuration=cfg-hotspot disabled=no`,
  ].join("; ");

  const wlan = `/interface wireless set [find default-name=wlan1]`;
  // Uma linha por comando e SEM [:parse]: o set essencial (modo AP + SSID) vem primeiro e cada
  // ajuste opcional tem a sua linha, entao um argumento recusado pela versao do RouterOS nao
  // impede o resto. Num roteador do outro pacote, so a linha daquele pacote da erro e a colagem segue.
  return [
    `:do { ${wlan} mode=ap-bridge ssid="${ssid}" disabled=no } on-error={ :put "Aviso: Wi-Fi (wlan1) nao configurado" }`,
    ...[`default-forwarding=no`, `band=2ghz-b/g/n`, `frequency-mode=regulatory-domain`, `country=brazil`]
      .map((arg) => `:do { ${wlan} ${arg} } on-error={ }`),
    `:do { :local f [:parse "${emString(wifi)}"]; $f } on-error={ }`,
    `:do { :put ("Wi-Fi wlan1: " . [/interface wireless get [find default-name=wlan1] mode] . " / " . [/interface wireless get [find default-name=wlan1] ssid]) } on-error={ }`,
  ];
}

module.exports = { linhasWifi, emString };
