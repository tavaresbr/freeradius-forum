// Calculo da rede do hotspot a partir do "IP do gateway/prefixo" (ex.: 10.5.48.1/22).
// Puro (sem rede/banco): o assistente usa para montar network, validar o pool e evitar sobreposicao.

const PREFIXO_MIN = 16; // 65 mil enderecos: acima disso o DHCP/hotspot do RouterOS sofre
const PREFIXO_MAX = 29;

function ipParaInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || "").trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

function intParaIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/**
 * @param {string} enderecoCidr ex.: "10.5.50.1/24"
 * @returns {{ok:true, gateway, prefixo, rede, network, primeiroHost, ultimoHost, hosts, poolPadrao}|{ok:false, erro}}
 */
function calcularRede(enderecoCidr) {
  const [ip, pfx = "24"] = String(enderecoCidr || "").trim().split("/");
  const gw = ipParaInt(ip);
  const prefixo = /^\d{1,2}$/.test(pfx) ? Number(pfx) : NaN;
  if (gw === null) return { ok: false, erro: "IP do hotspot invalido (use o formato 10.5.50.1/24)." };
  if (!(prefixo >= PREFIXO_MIN && prefixo <= PREFIXO_MAX)) {
    return { ok: false, erro: `Prefixo /${pfx} fora do aceito (/${PREFIXO_MIN} a /${PREFIXO_MAX}).` };
  }
  const mascara = (0xffffffff << (32 - prefixo)) >>> 0;
  const rede = (gw & mascara) >>> 0;
  const broadcast = (rede | (~mascara >>> 0)) >>> 0;
  if (gw === rede || gw === broadcast) return { ok: false, erro: "O IP do gateway nao pode ser o endereco de rede nem o de broadcast." };
  const primeiroHost = rede + 1;
  const ultimoHost = broadcast - 1;
  // Pool padrao: todos os hosts, menos o gateway (no meio da faixa vira dois trechos, como o RouterOS aceita).
  let poolPadrao;
  if (gw === primeiroHost) poolPadrao = `${intParaIp(primeiroHost + 1)}-${intParaIp(ultimoHost)}`;
  else if (gw === ultimoHost) poolPadrao = `${intParaIp(primeiroHost)}-${intParaIp(ultimoHost - 1)}`;
  else poolPadrao = `${intParaIp(primeiroHost)}-${intParaIp(gw - 1)},${intParaIp(gw + 1)}-${intParaIp(ultimoHost)}`;
  return {
    ok: true,
    gateway: intParaIp(gw),
    prefixo,
    rede: intParaIp(rede),
    network: `${intParaIp(rede)}/${prefixo}`,
    primeiroHost: intParaIp(primeiroHost),
    ultimoHost: intParaIp(ultimoHost),
    hosts: ultimoHost - primeiroHost + 1,
    poolPadrao,
    _gw: gw, _rede: rede, _broadcast: broadcast,
  };
}

/** Confere se o pool ("a-b" ou "a-b,c-d") cabe na rede e nao contem o IP do gateway. */
function validarPool(poolRange, info) {
  const trechos = String(poolRange || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!trechos.length) return { ok: false, erro: "Informe a faixa do pool (ex.: 10.5.50.2-10.5.50.254)." };
  for (const t of trechos) {
    const [a, b = a] = t.split("-").map((x) => x.trim());
    const ia = ipParaInt(a);
    const ib = ipParaInt(b);
    if (ia === null || ib === null || ia > ib) return { ok: false, erro: `Faixa do pool invalida: ${t}.` };
    if (ia <= info._rede || ib >= info._broadcast) return { ok: false, erro: `A faixa ${t} sai da rede ${info.network}.` };
    if (info._gw >= ia && info._gw <= ib) return { ok: false, erro: `A faixa ${t} contem o IP do gateway (${info.gateway}).` };
  }
  return { ok: true };
}

/** true se as redes dos dois enderecos ("10.5.50.1/24" e "10.5.48.9/22") se sobrepoem. */
function redesSobrepoem(enderecoA, enderecoB) {
  const a = calcularRede(enderecoA);
  const b = calcularRede(enderecoB);
  if (!a.ok || !b.ok) return false;
  return a._rede <= b._broadcast && b._rede <= a._broadcast;
}

module.exports = { calcularRede, validarPool, redesSobrepoem, ipParaInt, intParaIp, PREFIXO_MIN, PREFIXO_MAX };
