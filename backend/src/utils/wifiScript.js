/**
 * Trecho "Wi-Fi" do script de instalacao rapida do roteador (RouterOS).
 * O codigo de cada familia fica numa string passada a [:parse] e executada dentro de :do/on-error:
 * assim o comando que nao existe no modelo (ex.: /interface wifi num hAP lite) so falha
 * dentro do :do e o script segue para a tentativa seguinte, em vez de quebrar a linha toda.
 *   1) pacote `wifi` (hAP ax, RouterOS 7.13+): /interface wifi
 *   2) pacote `wireless` (hAP ac/lite etc.): /interface wireless, wlan1
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

  // `set` essencial primeiro (so o que e' indispensavel); cada ajuste opcional em comando
  // proprio: se a versao do RouterOS recusar um argumento, os outros ainda sao aplicados.
  const opcionais = [
    `default-forwarding=no`,
    `band=2ghz-b/g/n`,
    `frequency-mode=regulatory-domain`,
    `country=brazil`,
  ].map((arg) => `:do { /interface wireless set [find default-name=wlan1] ${arg} } on-error={ }`);
  const wireless = [
    `/interface wireless set [find default-name=wlan1] mode=ap-bridge ssid="${ssid}" disabled=no`,
    ...opcionais,
    `:put "Wi-Fi configurado: ${ssid}"`,
  ].join("; ");

  return [
    `:do { [[:parse "${emString(wifi)}"]] } on-error={ :do { [[:parse "${emString(wireless)}"]] } on-error={ :put "Aviso: nao foi possivel configurar o Wi-Fi (nem /interface wifi nem wlan1)" } }`,
  ];
}

module.exports = { linhasWifi, emString };
