const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../../db');
const { ssidDoPeer } = require('../utils/ssid');
const { linhasWifi } = require('../utils/wifiScript');
const { credenciaisRoteador, emStringRouterOS } = require('../utils/roteadorAdmin');

const WG_URL = `http://127.0.0.1:${process.env.WG_PANEL_PORT || '51821'}`;
const WG_PASS = process.env.WG_PASS || '';
const COMPOSE_PATH = path.resolve(__dirname, '../../../infra/wireguard/docker-compose.yml');

let wgCookie = null;

const authenticate = async () => {
  try {
    const res = await axios.post(`${WG_URL}/api/session`, { password: WG_PASS });
    const setCookieHeader = res.headers['set-cookie'];
    if (Array.isArray(setCookieHeader)) {
      wgCookie = setCookieHeader[0].split(';')[0];
    } else if (setCookieHeader) {
      wgCookie = setCookieHeader.split(';')[0];
    }
    return true;
  } catch (error) {
    console.error('Erro ao autenticar no wg-easy:', error.message);
    return false;
  }
};

const makeRequest = async (method, path, data = null) => {
  if (!wgCookie) await authenticate();
  try {
    const res = await axios({
      method,
      url: `${WG_URL}${path}`,
      data,
      headers: { Cookie: wgCookie }
    });
    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      await authenticate();
      const res = await axios({
        method,
        url: `${WG_URL}${path}`,
        data,
        headers: { Cookie: wgCookie }
      });
      return res.data;
    }
    throw error;
  }
};

// Read current server settings from docker-compose.yml
const readComposeSettings = () => {
  const content = fs.readFileSync(COMPOSE_PATH, 'utf8');
  const wgPortMatch = content.match(/WG_PORT=(\d+)/);
  const wgHostMatch = content.match(/WG_HOST=([\d.]+)/);
  const panelPortMatch = content.match(/PORT=(\d+)/);
  return {
    wgPort: wgPortMatch ? wgPortMatch[1] : '51820',
    wgHost: wgHostMatch ? wgHostMatch[1] : (process.env.WG_HOST || ''),
    panelPort: panelPortMatch ? panelPortMatch[1] : '51821'
  };
};

exports.getServerSettings = async (req, res) => {
  try {
    const settings = readComposeSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: "Erro ao ler configurações", error: err.message });
  }
};

exports.updateServerSettings = async (req, res) => {
  try {
    const { wgPort, wgHost } = req.body;
    // Valores entram no docker-compose.yml: formato estrito (sem quebra de linha / YAML injetado).
    if (wgPort !== undefined && wgPort !== '' && !(/^\d{1,5}$/.test(String(wgPort)) && Number(wgPort) >= 1 && Number(wgPort) <= 65535)) {
      return res.status(400).json({ message: "Porta inválida" });
    }
    if (wgHost !== undefined && wgHost !== '' && !require('net').isIPv4(String(wgHost))) {
      return res.status(400).json({ message: "Host inválido (use o IPv4 público do servidor)" });
    }
    let content = fs.readFileSync(COMPOSE_PATH, 'utf8');

    if (wgPort) {
      content = content.replace(/WG_PORT=\d+/, () => `WG_PORT=${String(wgPort)}`);
    }
    if (wgHost) {
      content = content.replace(/WG_HOST=[\d.]+/, () => `WG_HOST=${String(wgHost)}`);
    }

    fs.writeFileSync(COMPOSE_PATH, content, 'utf8');

    // Restart Docker container with new settings
    const composeDir = path.dirname(COMPOSE_PATH);
    execSync('docker compose down && docker compose up -d', { cwd: composeDir, timeout: 30000 });

    // Wait for wg-easy to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));
    wgCookie = null; // Reset session

    const settings = readComposeSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error("Erro ao atualizar configurações:", err.message);
    res.status(500).json({ message: "Erro ao atualizar configurações", error: err.message });
  }
};

// Peers do wg-easy que pertencem a esta empresa (mapeados em empresa_vpn_peers).
const filtrarPeersDaEmpresa = async (allClients, empresaId) => {
  const [peerRows] = await db.execute(
    "SELECT wg_client_id FROM empresa_vpn_peers WHERE empresa_id = ?",
    [empresaId]
  );
  const allowedIds = new Set(peerRows.map(r => r.wg_client_id));
  return allClients.filter(c => allowedIds.has(c.id));
};

// Lista os peers da empresa consultando o wg-easy. Lança erro se o wg-easy estiver fora do ar.
exports.listarPeersDaEmpresa = async (empresaId) => {
  const allClients = await makeRequest('GET', '/api/wireguard/client');
  return filtrarPeersDaEmpresa(allClients, empresaId);
};

exports.getVpnStatus = async (req, res) => {
  try {
    const allClients = await makeRequest('GET', '/api/wireguard/client');
    const settings = readComposeSettings();
    let serverPublicKey = "Carregando (adicione um peer para ver)";
    let serverAddress = "10.8.0.1";
    let endpoint = `${settings.wgHost}:${settings.wgPort}`;

    // Filter clients to only show those mapped to this empresa
    const clients = await filtrarPeersDaEmpresa(allClients, req.empresa_id);

    if (allClients.length > 0) {
      const conf = await makeRequest('GET', `/api/wireguard/client/${allClients[0].id}/configuration`);
      const pkMatch = conf.match(/PublicKey\s*=\s*(.*)/);
      if (pkMatch) serverPublicKey = pkMatch[1];
      const epMatch = conf.match(/Endpoint\s*=\s*(.*)/);
      if (epMatch) endpoint = epMatch[1];
    }

    res.json({
       clients,
       server: {
         publicKey: serverPublicKey,
         address: serverAddress,
         endpoint: endpoint,
         subNet: "10.8.0.0/24"
       }
    });

  } catch (err) {
    console.error("Erro no getVpnStatus:", err.stack);
    res.status(500).json({ message: "Erro ao comunicar com WG", error: err.message });
  }
};

exports.createClient = async (req, res) => {
  try {
    const { name } = req.body;
    const client = await makeRequest('POST', '/api/wireguard/client', { name });

    // Map the new peer to this empresa
    // wg-easy returns the client list after creation; find the new one by name
    const clients = await makeRequest('GET', '/api/wireguard/client');
    const newClient = clients.find(c => c.name === name);
    if (newClient) {
      await db.execute(
        "INSERT INTO empresa_vpn_peers (empresa_id, wg_client_id, nome) VALUES (?, ?, ?)",
        [req.empresa_id, newClient.id, name]
      );
    }

    res.json(client);
  } catch (err) {
    res.status(500).json({ message: "Erro ao criar peer", error: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership before deleting
    const [[peer]] = await db.execute(
      "SELECT id FROM empresa_vpn_peers WHERE wg_client_id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!peer) {
      return res.status(403).json({ message: "Peer não pertence a esta empresa" });
    }

    await makeRequest('DELETE', `/api/wireguard/client/${id}`);
    await db.execute(
      "DELETE FROM empresa_vpn_peers WHERE wg_client_id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Erro ao deletar peer", error: err.message });
  }
};

exports.getClientConfig = async (req, res) => {
  try {
    const { id } = req.params;

    // O retorno inclui a chave privada e a preshared do peer: so a empresa dona
    // do peer pode le-las (mesma regra do deleteClient).
    const [[peer]] = await db.execute(
      "SELECT nome FROM empresa_vpn_peers WHERE wg_client_id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!peer) {
      return res.status(403).json({ message: "Peer não pertence a esta empresa" });
    }

    // Nome do roteador = nome do peer (so letras, numeros, ponto, hifen e underline).
    const nomeRoteador = String(peer.nome || "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

    const settings = readComposeSettings();
    const conf = await makeRequest('GET', `/api/wireguard/client/${id}/configuration`);
    
    const privKey = conf.match(/PrivateKey\s*=\s*(.*)/)[1].trim();
    const addressMatch = conf.match(/Address\s*=\s*(.*)/);
    const address = addressMatch ? addressMatch[1].trim() : "10.8.0.2/24";
    const pubKey = conf.match(/PublicKey\s*=\s*(.*)/)[1].trim();
    const pskMatch = conf.match(/PresharedKey\s*=\s*(.*)/);
    const presharedKey = pskMatch ? pskMatch[1].trim() : null;

    const pskLine = presharedKey ? ` preshared-key="${presharedKey}"` : '';

    // Script pensado para roteador RESETADO sem configuracao padrao
    // ("No Default Configuration"): nao ha bridge, DHCP client, DNS, NAT nem firewall.
    // Deixa o equipamento com internet, VPN, API e Wi-Fi prontos, esperando so o
    // wizard de Hotspot do painel. Cada linha e independente e idempotente (checa
    // antes de criar), entao tambem pode ser colado de novo sem erro.
    const WAN = "ether1";
    // Nome da rede Wi-Fi = nome do peer (padrao "Hotspot-WiFi" se vazio)
    const SSID = ssidDoPeer(peer.nome);
    const VPN_SERVER = "10.8.0.1";
    const { usuario: adminUsuario, senha: adminSenha } = credenciaisRoteador();

    // Cria so se nao existir nenhum item com esse comment.
    const unicoPorComment = (menu, comment, cmdAdd) =>
      `:if ([:len [${menu} find comment="${comment}"]]=0) do={ ${cmdAdd} comment="${comment}" }`;

    // Regra accept no INICIO da chain input, so para o servidor da VPN.
    // Se a chain estiver vazia, place-before=0 falha e cai no add simples.
    const regraVpn = (comment, protocolo, portas) => {
      const base = `/ip firewall filter add chain=input action=accept protocol=${protocolo} src-address=${VPN_SERVER} dst-port=${portas} comment="${comment}"`;
      return `:if ([:len [/ip firewall filter find comment="${comment}"]]=0) do={ :do { ${base} place-before=0 } on-error={ ${base} } }`;
    };

    // Regras base da chain input, adicionadas no FIM (a ordem de criacao e a ordem final).
    const regraInput = (comment, extra) =>
      unicoPorComment("/ip firewall filter", comment, `/ip firewall filter add chain=input ${extra}`);

    const routerOsScript = [
      ...(nomeRoteador ? [`# --- Nome do roteador ---`, `/system identity set name="${nomeRoteador}"`] : []),
      `# --- VPN WireGuard ---`,
      `:if ([:len [/interface wireguard find name=wg-hotspot]]=0) do={ /interface wireguard add listen-port=13231 mtu=1420 name=wg-hotspot private-key="${privKey}" }`,
      `:if ([:len [/interface wireguard peers find interface=wg-hotspot public-key="${pubKey}"]]=0) do={ /interface wireguard peers add allowed-address=10.8.0.0/24 endpoint-address=${settings.wgHost} endpoint-port=${settings.wgPort} interface=wg-hotspot public-key="${pubKey}"${pskLine} persistent-keepalive=25s }`,
      `:if ([:len [/ip address find address="${address}" interface=wg-hotspot]]=0) do={ /ip address add address=${address} interface=wg-hotspot }`,

      `# --- Internet (${WAN}), DNS e hora ---`,
      `:if ([:len [/ip dhcp-client find interface=${WAN}]]=0) do={ /ip dhcp-client add interface=${WAN} disabled=no use-peer-dns=yes add-default-route=yes comment="WAN" }`,
      `/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes`,
      `/system clock set time-zone-name=America/Sao_Paulo`,
      `/system ntp client set enabled=yes`,
      `:if ([:len [/system ntp client servers find address="a.ntp.br"]]=0) do={ /system ntp client servers add address=a.ntp.br }`,
      `:if ([:len [/system ntp client servers find address="b.ntp.br"]]=0) do={ /system ntp client servers add address=b.ntp.br }`,

      `# --- NAT da saida de internet ---`,
      unicoPorComment("/ip firewall nat", "Masquerade WAN", `/ip firewall nat add chain=srcnat out-interface=${WAN} action=masquerade`),

      `# --- Firewall: protege o roteador pela WAN e libera so o servidor na VPN ---`,
      regraInput("Aceita conexoes estabelecidas", "action=accept connection-state=established,related,untracked"),
      regraInput("Descarta conexoes invalidas", "action=drop connection-state=invalid"),
      regraInput("Aceita ICMP", "action=accept protocol=icmp"),
      regraVpn("API do painel via VPN", "tcp", "8728"),
      regraVpn("CoA RADIUS via VPN", "udp", "3799"),
      regraVpn("Winbox/SSH via VPN", "tcp", "8291,22"),
      regraInput("Bloqueia entrada pela WAN", `action=drop in-interface=${WAN}`),

      `# --- Servicos: API so pela VPN; fecha os inseguros ---`,
      `:do { /ip service set api disabled=no available-from=10.8.0.0/24 } on-error={ /ip service set api disabled=no address=10.8.0.0/24 }`,
      `/ip service set telnet disabled=yes`,
      `/ip service set ftp disabled=yes`,
      `/ip service set www disabled=yes`,

      `# --- Wi-Fi aberto, com clientes isolados entre si (o portal cativo controla o acesso) ---`,
      ...linhasWifi(SSID),

      ...(adminSenha
        ? [
            `# --- Usuario e senha do roteador (mesmos do cadastro do equipamento no painel) ---`,
            `/user set [find name="${emStringRouterOS(adminUsuario)}"] password="${emStringRouterOS(adminSenha)}"`,
            `# --- Falta so: o wizard de Hotspot no painel ---`,
          ]
        : [
            `# --- Falta so: senha do admin e o wizard de Hotspot no painel ---`,
            `:put "ATENCAO: defina a senha do admin com: /user set admin password=SUA_SENHA (use a mesma no cadastro do equipamento no painel)"`,
          ]),
    ].join("\n");

    res.json({ conf, routerOsScript });
  } catch (err) {
    res.status(500).json({ message: "Erro ao obter config", error: err.message });
  }
};

