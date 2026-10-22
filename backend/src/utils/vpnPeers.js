// Peers WireGuard (wg-easy) ainda sem equipamento cadastrado.
// peers: [{ name, address, latestHandshakeAt }]; ipsUsados: IPs já em mikrotiks.
const ONLINE_MS = 3 * 60 * 1000; // mesmo critério da página VPN (handshake nos últimos 3 min)

function peersLivres(peers, ipsUsados, agora = Date.now()) {
  const usados = new Set((ipsUsados || []).map((ip) => String(ip).trim()));
  return (peers || [])
    .map((p) => ({
      nome: String(p.name || ""),
      ip: String(p.address || "").split("/")[0].trim(),
      online: !!p.latestHandshakeAt && agora - new Date(p.latestHandshakeAt).getTime() < ONLINE_MS,
    }))
    .filter((p) => p.ip && !usados.has(p.ip))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
}

module.exports = { peersLivres };
