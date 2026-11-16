// Tipos de equipamento (mesmos ids de mikrotiks.tipo e empresa_vpn_peers.tipo). Usado no assistente
// "Adicionar Equipamento", no "Adicionar Peer" e na coluna Tipo da tela VPN.
export const VENDORS = [
  {
    id: "mikrotik",
    nome: "MikroTik",
    desc: "RouterOS via API. Hotspot nativo com FreeRADIUS — setup automático completo.",
    badge: "bg-sky-900/30 border-sky-800/50 text-sky-400",
  },
  {
    id: "omada",
    nome: "TP-Link Omada",
    desc: "Controller Omada (software, OC200/OC300) via External RADIUS. Nomes dos APs via API: botão API na lista.",
    badge: "bg-emerald-900/30 border-emerald-800/50 text-emerald-400",
  },
  {
    id: "unifi",
    nome: "Ubiquiti UniFi",
    desc: "Controller UniFi via API. Autorização e sessões pela API do controller — setup simples, validado em campo.",
    badge: "bg-indigo-900/30 border-indigo-800/50 text-indigo-400",
  },
  {
    id: "grandstream",
    nome: "Grandstream GWN",
    desc: "APs GWN via External Web Portal + External RADIUS. Chaves GWN Cloud opcionais (só monitoramento).",
    badge: "bg-rose-900/30 border-rose-800/50 text-rose-400",
  },
  {
    id: "intelbras",
    nome: "Intelbras",
    desc: "APs Intelbras standalone (AP 360/1210/1250/3000) via portal externo + External RADIUS.",
    badge: "bg-teal-900/30 border-teal-800/50 text-teal-400",
  },
];

// Vendor pelo id (peer antigo/sem tipo = MikroTik)
export const vendorDoTipo = (tipo) => VENDORS.find((v) => v.id === tipo) || VENDORS[0];
