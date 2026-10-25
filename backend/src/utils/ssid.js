const SSID_PADRAO = "Hotspot-WiFi";

/**
 * Nome do peer -> SSID seguro para colar no terminal RouterOS: sem acento, so letras,
 * numeros, espaco, ponto, hifen e underline, ate 32 caracteres (limite do SSID).
 * Vazio => padrao.
 */
function ssidDoPeer(nome) {
  const limpo = String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return limpo || SSID_PADRAO;
}

module.exports = { ssidDoPeer, SSID_PADRAO };
