// A lib `node-routeros` fala Windows-1252 com o roteador (Transmitter/Receiver usam iconv 'win1252'),
// mas o RouterOS guarda texto em UTF-8. Resultado sem tratamento:
//   - leitura: "Grátis" (UTF-8: C3 A1) chega como "GrÃ¡tis";
//   - escrita: "Grátis" sai com 1 byte (E1), invalido em UTF-8 (o celular mostra "Gr?tis").
// Estas duas funcoes fazem a ida e volta exata. TODO texto com acento lido da lib passa por
// `lerDoRoteador` e TODO texto com acento enviado a ela passa por `paraORoteador`.
const iconv = require("iconv-lite");

/** Texto lido da lib -> texto certo (UTF-8 reinterpretado). */
function lerDoRoteador(texto) {
  if (typeof texto !== "string" || texto === "") return texto;
  return Buffer.from(iconv.encode(texto, "win1252")).toString("utf8");
}

/** Texto certo -> o que a lib deve receber para o roteador gravar em UTF-8. */
function paraORoteador(texto) {
  if (typeof texto !== "string" || texto === "") return texto;
  return iconv.decode(Buffer.from(texto, "utf8"), "win1252");
}

module.exports = { lerDoRoteador, paraORoteador };
