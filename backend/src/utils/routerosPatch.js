// Conserto da node-routeros 1.6.8 para o RouterOS 7: quando uma listagem vem VAZIA o roteador
// responde `!empty` e depois `!done`. A biblioteca nao conhece `!empty`: cai no ramo "desconhecido",
// LANCA uma excecao dentro do handler do socket e deixa o Receiver travado, entao toda resposta
// seguinte daquela conexao some (comando aplicado no roteador, mas "timeout" para nos). Foi a causa
// dos falsos negativos do assistente do hotspot (RB08/RB09: "bridge nao apareceu", "sem confirmacao
// das portas", "concluida" sem nada configurado).
//
// Aqui `!empty` e' ignorado: o `!done` que vem logo depois fecha o canal com a lista vazia.
// Aplicado uma unica vez, por qualquer modulo que fale com o roteador (`require` deste arquivo).
const { Channel } = require("node-routeros/dist/Channel");

function aplicar() {
  if (Channel.prototype.__apexEmptyPatch) return false;
  const original = Channel.prototype.processPacket;
  Channel.prototype.processPacket = function (packet) {
    if (Array.isArray(packet) && packet[0] === "!empty") return;
    return original.call(this, packet);
  };
  Channel.prototype.__apexEmptyPatch = true;
  return true;
}

aplicar();
module.exports = { aplicar };
