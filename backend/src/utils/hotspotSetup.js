const { RouterOSAPI } = require("node-routeros");
const { calcularRede, validarPool, redesSobrepoem } = require("./redeHotspot");
const { HOTSPOT_PADROES, DNS_SEGURO, BRIDGE_HOTSPOT, ON_LOGOUT_HOTSPOT, scriptOnLogout } = require("../constants/hotspotDefaults");

const NOME_PORTA_VALIDO = /^[A-Za-z0-9._-]{1,32}$/;
const TIPOS_PORTA_BRIDGE = /^(ether|wlan|wifi)/i;

/** Normaliza o pedido de bridge vindo do corpo da requisicao (nunca confiar no cliente). */
function sanitizarBridge(config = {}) {
  if (config.criarBridge !== true) return { criarBridge: false, portasBridge: [] };
  const lista = Array.isArray(config.portasBridge) ? config.portasBridge : [];
  const portas = [...new Set(lista.filter((p) => typeof p === "string" && NOME_PORTA_VALIDO.test(p)))]
    .slice(0, BRIDGE_HOTSPOT.maxPortas);
  return { criarBridge: true, portasBridge: portas };
}

const ehInterfaceWifi = (nome = "", tipo = "") => /^wlan|^wifi/i.test(nome) || /^(wlan|wireless)/i.test(tipo);

// RouterOS 7.15+ exige Message-Authenticator na resposta e descarta o Access-Accept do FreeRADIUS
// sem ele; no v6 o parametro nao existe (erro esperado, nao e falha).
const SEM_MESSAGE_AUTH = /no such command|unknown parameter|expected end of command|no such item/i;
async function desligarRequireMessageAuth(escrever, id) {
  try {
    await escrever("/radius/set", [`=.id=${id}`, "=require-message-auth=no"]);
    return true;
  } catch (e) {
    if (SEM_MESSAGE_AUTH.test(e.message || "")) return false;
    throw e;
  }
}

/**
 * Coloca a interface Wi-Fi em modo AP com o SSID informado (pacote wireless legado).
 * `print`/`write` sao os helpers do assistente (safePrint/safeWrite). Nunca lanca:
 * devolve { status: "ok" | "aviso", message } para virar um step.
 */
async function configurarWifiAP({ ifName, ssid, print, write }) {
  const nome = String(ssid || "").trim();
  if (!nome || nome.length > 32 || /[\x00-\x1f]/.test(nome)) {
    return { status: "aviso", message: "Nome do Wi-Fi (SSID) invalido (1 a 32 caracteres); Wi-Fi nao alterado." };
  }
  try {
    const lista = await print("/interface/wireless/print");
    const atual = lista.find((w) => w.name === ifName);
    if (!atual) {
      return { status: "aviso", message: `Este roteador nao usa o pacote wireless legado (ou ${ifName} nao e Wi-Fi). Configure o SSID manualmente em /interface wifi.` };
    }
    await write("/interface/wireless/set", [
      `=numbers=${ifName}`, "=mode=ap-bridge", `=ssid=${nome}`, "=security-profile=default", "=disabled=no",
    ]);
    const depois = (await print("/interface/wireless/print")).find((w) => w.name === ifName);
    if (depois && depois.mode === "ap-bridge" && depois.ssid === nome) {
      return { status: "ok", message: `Wi-Fi ${ifName}: modo AP, SSID "${nome}"` };
    }
    return { status: "aviso", message: `Sem confirmacao do Wi-Fi. Confira: /interface wireless set ${ifName} mode=ap-bridge ssid="${nome}" disabled=no` };
  } catch (e) {
    return { status: "aviso", message: `Wi-Fi nao configurado: ${e.message}` };
  }
}

/**
 * Prepara a bridge do hotspot: cria `BRIDGE_HOTSPOT.nome` se faltar e coloca nela as portas escolhidas.
 * Recusa porta inexistente, de tipo nao suportado, WAN, de outra bridge, com IP ou com DHCP server
 * proprio (entrar na bridge invalidaria o IP e pode derrubar o acesso). Idempotente. Nunca lanca:
 * devolve { ok, message, wifiPortas } e so escreve no roteador se TODAS as portas forem aceitas.
 */
async function prepararBridgeHotspot({ portas, print, write, nome = BRIDGE_HOTSPOT.nome }) {
  const falha = (message) => ({ ok: false, message, wifiPortas: [] });
  try {
    if (!Array.isArray(portas) || portas.length === 0) return falha("Escolha ao menos uma porta/radio para a bridge do hotspot.");
    if (portas.length > BRIDGE_HOTSPOT.maxPortas) return falha(`Maximo de ${BRIDGE_HOTSPOT.maxPortas} portas na bridge.`);

    const interfaces = await print("/interface/print");
    const bridges = await print("/interface/bridge/print");
    const portasBridge = await print("/interface/bridge/port/print");
    const enderecos = await print("/ip/address/print");
    const dhcps = await print("/ip/dhcp-server/print");
    const dhcpClients = await print("/ip/dhcp-client/print");
    const pppoe = await print("/interface/pppoe-client/print");
    const rotas = await print("/ip/route/print");

    const wan = new Set([
      ...dhcpClients.map((d) => d.interface),
      ...pppoe.map((x) => x.interface),
      ...rotas.filter((r) => r["dst-address"] === "0.0.0.0/0")
        .map((r) => ((r["gateway-status"] || "").match(/via\s+(\S+)/) || [])[1] || r.gateway),
    ].filter(Boolean));

    for (const porta of portas) {
      const itf = interfaces.find((i) => i.name === porta);
      if (!itf) return falha(`A interface ${porta} nao existe neste roteador.`);
      if (!TIPOS_PORTA_BRIDGE.test(porta) && !TIPOS_PORTA_BRIDGE.test(itf.type || "")) {
        return falha(`A interface ${porta} (${itf.type || "?"}) nao pode entrar na bridge do hotspot (so ethernet e Wi-Fi).`);
      }
      if (wan.has(porta)) return falha(`A interface ${porta} e a WAN (uplink de internet); nao pode entrar na bridge do hotspot.`);
      const jaBridge = portasBridge.find((b) => b.interface === porta);
      if (jaBridge && jaBridge.bridge !== nome) {
        return falha(`A interface ${porta} ja e porta da bridge ${jaBridge.bridge}. Remova-a de la antes (/interface bridge port remove).`);
      }
      if (enderecos.some((a) => a.interface === porta)) {
        return falha(`A interface ${porta} tem IP configurado; adicionar a uma bridge invalidaria o IP e pode derrubar o acesso. Remova o IP antes.`);
      }
      if (dhcps.some((d) => d.interface === porta)) {
        return falha(`A interface ${porta} tem DHCP server proprio; remova-o antes de usar a porta na bridge do hotspot.`);
      }
    }

    if (!bridges.some((b) => b.name === nome)) {
      const r = await write("/interface/bridge/add", [`=name=${nome}`, "=comment=hotspot"]);
      if (r === "timeout") return falha(`Sem resposta ao criar a bridge ${nome}.`);
    }
    for (const porta of portas) {
      if (portasBridge.some((b) => b.interface === porta && b.bridge === nome)) continue;
      const r = await write("/interface/bridge/port/add", [`=bridge=${nome}`, `=interface=${porta}`]);
      if (r === "timeout") return falha(`Sem resposta ao adicionar ${porta} na bridge ${nome}.`);
    }

    const depois = await print("/interface/bridge/port/print");
    const faltando = portas.filter((p) => !depois.some((b) => b.interface === p && b.bridge === nome));
    if (faltando.length) return falha(`Sem confirmacao de que ${faltando.join(", ")} entrou na bridge ${nome}.`);

    const wifiPortas = portas.filter((p) => ehInterfaceWifi(p));
    // Isolamento entre clientes do mesmo radio (pacote wireless legado); best-effort, como no script de instalacao.
    for (const p of wifiPortas) {
      try { await write("/interface/wireless/set", [`=numbers=${p}`, "=default-forwarding=no"]); } catch (e) { /* pacote wifi novo */ }
    }
    return { ok: true, message: `Bridge ${nome} com ${portas.join(", ")}`, wifiPortas };
  } catch (e) {
    return falha(`Bridge do hotspot nao preparada: ${e.message}`);
  }
}

/**
 * Liga ou desliga o DNS seguro (filtro de conteudo adulto) do hotspot. Nunca lanca: devolve
 * { status: "ok" | "aviso", message }. `ligar` = true aplica; false so reverte se o roteador estiver
 * usando os servidores filtrados (nao desfaz DNS configurado a mao).
 */
async function configurarDnsSeguro({ ligar, gateway, network, print, write }) {
  try {
    const nets = await print("/ip/dhcp-server/network/print");
    const rede = nets.find((n) => n.address === network);
    if (ligar) {
      await write("/ip/dns/set", [`=servers=${DNS_SEGURO.servidores}`, "=allow-remote-requests=yes"]);
      if (rede) await write("/ip/dhcp-server/network/set", [`=.id=${rede[".id"]}`, `=dns-server=${gateway}`]);
      return { status: "ok", message: `DNS seguro ligado (OpenDNS FamilyShield); clientes usam ${gateway} como DNS` };
    }
    const dns = (await print("/ip/dns/print"))[0];
    if (!dns) return { status: "aviso", message: "Nao foi possivel ler o DNS do roteador; DNS seguro nao alterado." };
    if (!String(dns.servers || "").includes(DNS_SEGURO.servidores.split(",")[0])) {
      return { status: "ok", message: "DNS seguro ja estava desligado" };
    }
    await write("/ip/dns/set", [`=servers=${DNS_SEGURO.padrao}`, "=allow-remote-requests=yes"]);
    if (rede) await write("/ip/dhcp-server/network/set", [`=.id=${rede[".id"]}`, "=dns-server=8.8.8.8"]);
    return { status: "ok", message: "DNS seguro desligado (DNS padrao restaurado)" };
  } catch (e) {
    return { status: "aviso", message: `DNS seguro nao alterado: ${e.message}` };
  }
}

/**
 * on-logout opcional do user profile "default" (nunca lanca). Nunca sobrescreve script alheio:
 * so grava se estiver vazio ou for o nosso (marcador); leitura que falha = nao grava.
 */
async function configurarOnLogout({ ligar, print, write }) {
  try {
    const perfis = await print("/ip/hotspot/user/profile/print", ["=.proplist=.id,name,on-logout"]);
    const padrao = Array.isArray(perfis) ? perfis.find((p) => p.name === "default") : null;
    if (!padrao) return { status: "aviso", message: "Nao foi possivel ler o user profile default; on-logout nao alterado." };
    const atual = String(padrao["on-logout"] || "").trim();
    const nosso = atual.includes(ON_LOGOUT_HOTSPOT.marcador);
    if (atual && !nosso) {
      return { status: "aviso", message: "O user profile default ja tem um on-logout proprio; nao foi alterado." };
    }
    if (ligar) {
      await write("/ip/hotspot/user/profile/set", ["=numbers=default", `=on-logout=${scriptOnLogout()}`]);
      return { status: "ok", message: "on-logout ligado: ao fim da sessao o aparelho e' desconectado do Wi-Fi (se nao houver outra sessao dele)" };
    }
    if (!nosso) return { status: "ok", message: "on-logout ja estava desligado" };
    await write("/ip/hotspot/user/profile/set", ["=numbers=default", "=on-logout="]);
    return { status: "ok", message: "on-logout desligado" };
  } catch (e) {
    return { status: "aviso", message: `on-logout nao alterado: ${e.message}` };
  }
}

/**
 * Configura hotspot completo no MikroTik via API com streaming de steps.
 * Cada step é enviado em tempo real via callback onStep(step).
 *
 * Etapas:
 * 1. IP na interface
 * 2. Pool de IPs
 * 3. DHCP server + network
 * 4. Hotspot profile (com RADIUS)
 * 5. Hotspot server
 * 6. RADIUS client
 * 7. Walled garden
 * 8. Masquerade (NAT)
 * 9. Login page (download via /tool/fetch)
 */
async function configurarHotspot(mikrotik, portal, systemDomain, config = {}, empresa = {}, onStep = null, portalHost = null) {
  // Dominio proprio do portal (SaaS): redirect do login.html e walled garden passam a incluir o dominio da empresa.
  const dominiosLiberados = [...new Set([systemDomain, portalHost].filter(Boolean))];
  const conn = new RouterOSAPI({
    host: mikrotik.ip,
    user: mikrotik.usuario,
    password: mikrotik.senha,
    port: mikrotik.porta || 8728,
    keepalive: false,
    timeout: 30000,
  });

  const steps = [];
  const { criarBridge, portasBridge } = sanitizarBridge(config);
  const ifName = criarBridge ? BRIDGE_HOTSPOT.nome : (config.interface || "ether2");
  const localAddress = config.localAddress || "10.5.50.1/24";
  const poolName = config.poolName || "hs-pool";
  const dnsName = config.dnsName || "";
  const wifiSsid = (config.wifiSsid || "").trim();
  const radiusServerIp = config.radiusServerIp || "10.8.0.1";
  const radiusSecret = config.radiusSecret || mikrotik.senha;

  // Rede calculada de verdade (antes assumia /24 alinhado e errava /23 e /22).
  const infoRede = calcularRede(localAddress);
  const gateway = infoRede.ok ? infoRede.gateway : localAddress.split("/")[0];
  const network = infoRede.ok ? infoRede.network : localAddress;
  // Sem faixa informada, o pool cobre a rede inteira (menos o gateway).
  const poolRange = (config.poolRange && String(config.poolRange).trim()) || (infoRede.ok ? infoRede.poolPadrao : "");

  const PRINT_TIMEOUT = 3000;
  const WRITE_TIMEOUT = 10000;
  // /tool/fetch conclui no roteador mas, em alguns modelos (hAP), a resposta da API
  // demora ou nunca volta; por isso o resultado e confirmado em /file/print.
  const FETCH_TIMEOUT = 45000;
  const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const safePrint = async (path) => {
    return Promise.race([
      conn.write(path).then(r => Array.isArray(r) ? r : []).catch(e => {
        if (e.errno === "UNKNOWNREPLY" || (e.message && e.message.includes("!empty"))) return [];
        throw e;
      }),
      new Promise(resolve => setTimeout(() => resolve([]), PRINT_TIMEOUT))
    ]);
  };

  const safeWrite = async (path, args, timeoutMs = WRITE_TIMEOUT) => {
    return Promise.race([
      conn.write(path, args).catch(e => {
        if (e.errno === "UNKNOWNREPLY") return "ok";
        if (e.message && e.message.includes("already")) return "exists";
        throw e;
      }),
      new Promise(resolve => setTimeout(() => resolve("timeout"), timeoutMs))
    ]);
  };

  // Le um arquivo do roteador. Lista todos os arquivos (nunca vem vazia, entao nao
  // sofre do !empty) e so pede o conteudo quando o arquivo existe.
  const lerArquivo = async (caminho) => {
    const lista = await Promise.race([
      conn.write("/file/print", ["=.proplist=name,size,creation-time"]).then(r => Array.isArray(r) ? r : []).catch(() => []),
      new Promise(resolve => setTimeout(() => resolve([]), 8000)),
    ]);
    const info = lista.find(f => f.name === caminho);
    if (!info) return null;
    const comConteudo = await Promise.race([
      conn.write("/file/print", [`?name=${caminho}`, "=.proplist=name,contents"]).then(r => Array.isArray(r) ? r : []).catch(() => []),
      new Promise(resolve => setTimeout(() => resolve([]), 8000)),
    ]);
    return { ...info, contents: (comConteudo[0] && comConteudo[0].contents) || "" };
  };

  const addStep = (name, status, message) => {
    const step = { step: name, status, message, timestamp: new Date().toISOString() };
    steps.push(step);
    console.log(`[hotspot] ${status}: ${message}`);
    if (onStep) onStep(step);
  };

  try {
    // Rede e pool invalidos param ANTES de qualquer conexao ou escrita no roteador.
    const poolOk = infoRede.ok ? validarPool(poolRange, infoRede) : { ok: false, erro: infoRede.erro };
    if (!poolOk.ok) {
      addStep("rede", "erro", poolOk.erro);
      return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
    }

    await conn.connect();
    addStep("conexao", "ok", `Conectado a ${mikrotik.ip}`);

    // === 00. Bridge do hotspot (opcional): varias radios/portas na mesma rede ===
    let wifiPortasBridge = [];
    if (criarBridge) {
      const b = await prepararBridgeHotspot({ portas: portasBridge, print: safePrint, write: safeWrite });
      if (!b.ok) {
        addStep("bridge", "erro", b.message);
        try { await conn.close(); } catch (e) {}
        return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
      }
      addStep("bridge", "ok", b.message);
      wifiPortasBridge = b.wifiPortas;
    }

    // === 0. Interface nao pode ser porta de bridge (slave) ===
    // IP/DHCP em porta de bridge ficam invalidos e o hotspot nao atende os clientes.
    const bridgePorts = await safePrint("/interface/bridge/port/print");
    const bp = bridgePorts.find(b => b.interface === ifName);
    if (bp) {
      addStep("interface", "erro",
        `A interface ${ifName} e porta da bridge ${bp.bridge}. Remova-a da bridge (/interface bridge port remove) ou escolha outra interface livre.`);
      try { await conn.close(); } catch (e) {}
      return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
    }

    // === 0b. Interface nao pode ser a WAN (hotspot na uplink derruba a internet do roteador) ===
    const dhcpClients = await safePrint("/ip/dhcp-client/print");
    const pppoeClients = await safePrint("/interface/pppoe-client/print");
    const rotas = await safePrint("/ip/route/print");
    const ehWan = dhcpClients.some(d => d.interface === ifName)
      || pppoeClients.some(p => p.interface === ifName)
      || rotas.some(r => r["dst-address"] === "0.0.0.0/0"
        && (((r["gateway-status"] || "").match(/via\s+(\S+)/) || [])[1] === ifName || r.gateway === ifName));
    if (ehWan) {
      addStep("interface", "erro",
        `A interface ${ifName} e a WAN (uplink de internet) deste roteador. Escolha a interface da rede local/Wi-Fi.`);
      try { await conn.close(); } catch (e) {}
      return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
    }

    // === 0c. Wi-Fi: modo AP + SSID (so se a interface for Wi-Fi e o SSID foi informado) ===
    if (wifiSsid) {
      const radios = criarBridge ? wifiPortasBridge : (ehInterfaceWifi(ifName) ? [ifName] : []);
      for (const radio of radios) {
        const w = await configurarWifiAP({ ifName: radio, ssid: wifiSsid, print: safePrint, write: safeWrite });
        addStep("wifi", w.status, `${radio}: ${w.message}`);
      }
    }

    // === 0d. A rede nao pode se sobrepor a de outra interface (rota ambigua derruba clientes) ===
    {
      const jaTem = await safePrint("/ip/address/print");
      const conflito = jaTem.find((a) => a.interface !== ifName && a.address && redesSobrepoem(localAddress, a.address));
      if (conflito) {
        addStep("rede", "erro",
          `A rede ${network} se sobrepoe a ${conflito.address} da interface ${conflito.interface}. Escolha outra faixa de IP para o hotspot.`);
        try { await conn.close(); } catch (e) {}
        return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
      }
      if (infoRede.hosts) addStep("rede", "ok", `Rede ${network}: ate ${infoRede.hosts} clientes`);
    }

    // === 1. IP na interface ===
    try {
      const addresses = await safePrint("/ip/address/print");
      const hasAddr = addresses && addresses.find(a => a.interface === ifName);
      if (!hasAddr) {
        await safeWrite("/ip/address/add", [`=address=${localAddress}`, `=interface=${ifName}`]);
        addStep("ip", "ok", `IP ${localAddress} atribuido a ${ifName}`);
      } else {
        addStep("ip", "ok", `${ifName} ja tem IP: ${hasAddr.address}`);
      }
    } catch (e) {
      addStep("ip", "aviso", e.message);
    }

    // === 2. Pool ===
    try {
      const pools = await safePrint("/ip/pool/print");
      const exists = pools && pools.find(p => p.name === poolName);
      if (!exists) {
        await safeWrite("/ip/pool/add", [`=name=${poolName}`, `=ranges=${poolRange}`]);
        addStep("pool", "ok", `Pool ${poolName} criado (${poolRange})`);
      } else {
        addStep("pool", "ok", `Pool ${poolName} existe`);
      }
    } catch (e) {
      addStep("pool", "aviso", e.message);
    }

    // === 3. DHCP Server + Network ===
    try {
      const nets = await safePrint("/ip/dhcp-server/network/print");
      const netExists = nets && nets.find(n => n.address === network);
      if (!netExists) {
        await safeWrite("/ip/dhcp-server/network/add", [
          `=address=${network}`,
          `=gateway=${gateway}`,
          `=dns-server=8.8.8.8`,
        ]);
      }

      const dhcps = await safePrint("/ip/dhcp-server/print");
      const dhcpExists = dhcps && dhcps.find(d => d.interface === ifName);
      if (!dhcpExists) {
        await safeWrite("/ip/dhcp-server/add", [
          `=name=dhcp-hotspot`,
          `=interface=${ifName}`,
          `=address-pool=${poolName}`,
          `=lease-time=${HOTSPOT_PADROES.dhcpLeaseTime}`,
          "=authoritative=after-2sec-delay",
          `=disabled=no`,
        ]);
        addStep("dhcp", "ok", `DHCP server criado em ${ifName}`);
      } else {
        addStep("dhcp", "ok", `DHCP ja existe em ${ifName}`);
      }
    } catch (e) {
      addStep("dhcp", "aviso", e.message);
    }

    // === 3b. DNS seguro (so se o assistente pediu: true liga, false desliga, ausente nao mexe) ===
    if (config.dnsSeguro === true || config.dnsSeguro === false) {
      const d = await configurarDnsSeguro({ ligar: config.dnsSeguro, gateway, network, print: safePrint, write: safeWrite });
      addStep("dns_seguro", d.status, d.message);
    }

    // === 4. Hotspot Profile ===
    try {
      const profiles = await safePrint("/ip/hotspot/profile/print");
      const prof = profiles && profiles.find(p => p.name === "hsprof-hotspot");
      const profArgs = [
        `=login-by=${HOTSPOT_PADROES.loginBy}`,
        "=use-radius=yes",
        "=radius-accounting=yes",
        "=html-directory=hotspot",
        `=radius-interim-update=${HOTSPOT_PADROES.radiusInterimUpdate}`,
        ...(dnsName ? [`=dns-name=${dnsName}`] : []),
      ];

      if (prof) {
        await safeWrite("/ip/hotspot/profile/set", [`=.id=${prof[".id"]}`, ...profArgs]);
        addStep("profile", "ok", "Profile atualizado (RADIUS habilitado)");
      } else {
        await safeWrite("/ip/hotspot/profile/add", ["=name=hsprof-hotspot", ...profArgs]);
        addStep("profile", "ok", "Profile hsprof-hotspot criado");
      }
    } catch (e) {
      addStep("profile", "aviso", e.message);
    }

    // === 5. Hotspot Server ===
    try {
      const servers = await safePrint("/ip/hotspot/print");
      const hs = servers && servers.find(s => s.name === "hotspot1");
      if (hs) {
        await safeWrite("/ip/hotspot/set", [
          `=.id=${hs[".id"]}`,
          `=interface=${ifName}`,
          `=address-pool=${poolName}`,
          "=profile=hsprof-hotspot",
          `=addresses-per-mac=${HOTSPOT_PADROES.addressesPerMac}`,
          "=disabled=no",
        ]);
        addStep("hotspot", "ok", "Hotspot server atualizado");
      } else {
        const r = await safeWrite("/ip/hotspot/add", [
          "=name=hotspot1",
          `=interface=${ifName}`,
          `=address-pool=${poolName}`,
          "=profile=hsprof-hotspot",
          `=addresses-per-mac=${HOTSPOT_PADROES.addressesPerMac}`,
          "=disabled=no",
        ]);
        if (r === "exists") {
          // hotspot1 ja existia (print pode ter estourado o timeout): forcar interface correta
          await safeWrite("/ip/hotspot/set", [
            "=numbers=hotspot1",
            `=interface=${ifName}`,
            `=address-pool=${poolName}`,
            "=profile=hsprof-hotspot",
            `=addresses-per-mac=${HOTSPOT_PADROES.addressesPerMac}`,
            "=disabled=no",
          ]);
          addStep("hotspot", "ok", `Hotspot server ja existia, atualizado para ${ifName}`);
        } else {
          addStep("hotspot", "ok", "Hotspot server criado");
        }
      }
    } catch (e) {
      addStep("hotspot", "aviso", e.message);
    }

    // === 5a. IP binding: o proprio gateway do hotspot nunca passa pelo login ===
    try {
      const binds = await safePrint("/ip/hotspot/ip-binding/print");
      if (!binds.find(b => b.address === gateway && b.type === "bypassed")) {
        await safeWrite("/ip/hotspot/ip-binding/add", [`=address=${gateway}`, "=type=bypassed", "=comment=hotspot-gateway"]);
      }
    } catch (e) {
      addStep("ip_binding", "aviso", e.message);
    }

    // === 5b. User Profile default - garante address-pool ===
    // Sem isso, quando o RADIUS retorna um groupname que nao existe como profile,
    // o MikroTik aplica o "default" que vem com address-pool=none de fabrica
    // e o login da "no address from ip pool" mesmo com Access-Accept.
    // Altera pelo NOME ("default"), sem depender do print (que expira em hAP lento e
    // fazia o wizard concluir, errado, que o perfil nao existia).
    try {
      const r = await safeWrite("/ip/hotspot/user/profile/set", [
        "=numbers=default",
        `=address-pool=${poolName}`,
        `=keepalive-timeout=${HOTSPOT_PADROES.keepaliveTimeout}`,
        `=idle-timeout=${HOTSPOT_PADROES.idleTimeout}`,
        "=add-mac-cookie=yes",
        `=mac-cookie-timeout=${HOTSPOT_PADROES.macCookieTimeout}`,
      ]);
      if (r === "timeout") {
        // O set pode ter sido aplicado mesmo sem resposta: confere o valor no roteador.
        await esperar(2000);
        const perfis = await Promise.race([
          conn.write("/ip/hotspot/user/profile/print", ["=.proplist=name,address-pool"]).then(x => Array.isArray(x) ? x : []).catch(() => []),
          new Promise(resolve => setTimeout(() => resolve([]), 8000)),
        ]);
        const padrao = perfis.find(p => p.name === "default");
        if (padrao && padrao["address-pool"] === poolName) {
          addStep("user-profile", "ok", `User profile default apontando para ${poolName} (confirmado no roteador)`);
        } else {
          addStep("user-profile", "aviso",
            `Sem resposta ao ajustar o user profile default. Confirme no MikroTik: /ip hotspot user profile print (address-pool deve ser ${poolName})`);
        }
      } else {
        addStep("user-profile", "ok", `User profile default apontando para ${poolName}`);
      }
    } catch (e) {
      addStep("user-profile", "aviso", `User profile default nao ajustado: ${e.message}. Ajuste: /ip hotspot user profile set [find name=default] address-pool=${poolName}`);
    }

    // === 5c. on-logout (so se o assistente pediu: true liga, false desliga, ausente nao mexe) ===
    if (config.onLogout === true || config.onLogout === false) {
      const o = await configurarOnLogout({ ligar: config.onLogout, print: safePrint, write: safeWrite });
      addStep("on_logout", o.status, o.message);
    }

    // === 6. RADIUS Client ===
    try {
      const radiusList = await safePrint("/radius/print");
      const existing = radiusList && radiusList.find(r => r.service && r.service.includes("hotspot"));
      const radiusArgs = [
        `=address=${radiusServerIp}`,
        `=secret=${radiusSecret}`,
        "=service=hotspot",
        "=authentication-port=1812",
        "=accounting-port=1813",
        `=timeout=${HOTSPOT_PADROES.radiusTimeout}`,
      ];

      if (existing) {
        await safeWrite("/radius/set", [`=.id=${existing[".id"]}`, ...radiusArgs]);
        addStep("radius", "ok", `RADIUS atualizado (${radiusServerIp})`);
      } else {
        await safeWrite("/radius/add", radiusArgs);
        addStep("radius", "ok", `RADIUS criado (${radiusServerIp})`);
      }

      await safeWrite("/radius/incoming/set", ["=accept=yes", "=port=3799"]);

      const cliRadius = (await safePrint("/radius/print")).find(r => r.service && r.service.includes("hotspot"));
      if (cliRadius) {
        const aplicado = await desligarRequireMessageAuth(safeWrite, cliRadius[".id"]);
        if (aplicado) addStep("radius_msgauth", "ok", "RADIUS: require-message-auth=no (RouterOS 7.15+)");
      }
    } catch (e) {
      addStep("radius", "aviso", e.message);
    }

    // === 7. Walled Garden ===
    if (systemDomain) {
      try {
        const wg = await safePrint("/ip/hotspot/walled-garden/print");
        for (const dominio of dominiosLiberados) {
          const exists = wg && wg.find(w => w["dst-host"] && w["dst-host"].includes(dominio));
          if (!exists) {
            await safeWrite("/ip/hotspot/walled-garden/add", [
              `=dst-host=*${dominio}*`,
              "=action=allow",
            ]);
            addStep("walled_garden", "ok", `Dominio liberado: ${dominio}`);
          } else {
            addStep("walled_garden", "ok", `Walled garden ja tem ${dominio}`);
          }
        }
        // Dominios do Mercado Pago SDK (necessario para pagamento com cartao)
        // www.mercadopago.com hospeda o security.js (device fingerprint anti-fraude).
        // Sem ele o window.MP_DEVICE_SESSION_ID nao popula e o MP rejeita cartao como high_risk.
        const mpDomains = ["www.mercadopago.com", "sdk.mercadopago.com", "api.mercadopago.com", "http2.mlstatic.com", "secure-fields.mercadopago.com", "api-static.mercadopago.com", "api.mercadolibre.com"];
        for (const domain of mpDomains) {
          const mpExists = wg && wg.find(w => w["dst-host"] && w["dst-host"].includes(domain));
          if (!mpExists) {
            await safeWrite("/ip/hotspot/walled-garden/add", [
              `=dst-host=*${domain}*`,
              "=action=allow",
            ]);
          }
        }
        addStep("walled_garden_mp", "ok", "Dominios Mercado Pago SDK liberados");
      } catch (e) {
        addStep("walled_garden", "aviso", e.message);
      }
    }

    // === 8. Masquerade (NAT) ===
    try {
      const natRules = await safePrint("/ip/firewall/nat/print");
      const hasMasquerade = natRules && natRules.find(r =>
        r.chain === "srcnat" && r.action === "masquerade" && r["src-address"] === network
      );
      if (!hasMasquerade) {
        await safeWrite("/ip/firewall/nat/add", [
          "=chain=srcnat",
          `=src-address=${network}`,
          "=action=masquerade",
          `=comment=hotspot-masquerade`,
        ]);
        addStep("masquerade", "ok", `NAT masquerade criado para ${network}`);
      } else {
        addStep("masquerade", "ok", `Masquerade ja existe para ${network}`);
      }
    } catch (e) {
      addStep("masquerade", "aviso", e.message);
    }

    // === 9. Login Page (download via /tool/fetch) ===
    try {
      const empresaId = empresa.id || mikrotik.empresa_id || '';
      const empresaSlug = empresa.slug || 'default';
      const fetchUrl = `https://${systemDomain}/api/hotspot-login/${mikrotik.id}`;

      // Resolve html-directory real do profile ativo (fallback: "hotspot").
      const htmlDir = await resolveHotspotHtmlDir(conn);
      const dstLogin = `${htmlDir}/login.html`;

      let ok = false;
      const motivos = [];
      const motivo = (r, e) => e ? e.message : (r === "timeout" ? "timeout" : String(r));

      // Estado do arquivo ANTES do download, para distinguir arquivo novo de sobra antiga.
      const antes = await lerArquivo(dstLogin);

      // Depois de um timeout, confere no roteador se o arquivo foi (re)gravado:
      // o creation-time mudou ou o conteudo cita o ID deste equipamento.
      // Em roteador lento o arquivo pode aparecer depois da resposta expirar: reconfere
      // algumas vezes antes de desistir.
      const confirmarDownload = async () => {
        for (let i = 0; i < 3; i++) {
          if (i > 0) await esperar(4000);
          const depois = await lerArquivo(dstLogin);
          if (!depois || !(Number(depois.size) > 0)) continue;
          if (!antes || depois["creation-time"] !== antes["creation-time"]) return true;
          if (new RegExp(`(redirect/|mikrotik_id=)${mikrotik.id}\\b`).test(depois.contents)) return true;
        }
        return false;
      };

      try {
        const r = await safeWrite("/tool/fetch", [
          `=url=${fetchUrl}`,
          `=dst-path=${dstLogin}`,
          "=mode=https",
          "=check-certificate=no",
        ], FETCH_TIMEOUT);
        if (r !== "timeout") {
          addStep("login_page", "ok", `login.html baixado em ${dstLogin} (HTTPS)`);
          ok = true;
        } else if (await confirmarDownload()) {
          addStep("login_page", "ok", `login.html baixado em ${dstLogin} (HTTPS; confirmado no roteador)`);
          ok = true;
        } else {
          motivos.push(`HTTPS: ${motivo(r)}`);
        }
      } catch (e) { motivos.push(`HTTPS: ${motivo(null, e)}`); /* tenta HTTP */ }

      if (!ok) {
        try {
          const r = await safeWrite("/tool/fetch", [
            `=url=http://${systemDomain}/api/hotspot-login/${mikrotik.id}`,
            `=dst-path=${dstLogin}`,
            "=mode=http",
          ], FETCH_TIMEOUT);
          if (r !== "timeout") {
            addStep("login_page", "ok", `login.html baixado em ${dstLogin} (HTTP)`);
            ok = true;
          } else if (await confirmarDownload()) {
            addStep("login_page", "ok", `login.html baixado em ${dstLogin} (HTTP; confirmado no roteador)`);
            ok = true;
          } else {
            motivos.push(`HTTP: ${motivo(r)}`);
          }
        } catch (e) { motivos.push(`HTTP: ${motivo(null, e)}`); /* fallback manual */ }
      }

      if (!ok) {
        const fullUrl = `https://${portalHost || systemDomain}/hotspot/redirect/${mikrotik.id}?mac=$(mac)&ip=$(ip)&mikrotik_id=${mikrotik.id}&empresa_id=${empresaId}&empresa=${empresaSlug}`;
        addStep("login_page", "aviso",
          `Nao conseguiu baixar automaticamente (${motivos.join(' | ') || 'sem detalhe'}). Verifique DNS/rota do MikroTik ate ${systemDomain}. Substitua ${dstLogin} manualmente com redirect para: ${fullUrl}`
        );
      }
    } catch (e) {
      addStep("login_page", "aviso", e.message);
    }

    // === 9b. error.html: franquia esgotada / login recusado volta ao portal (nao e' critico) ===
    try {
      const htmlDir = await resolveHotspotHtmlDir(conn);
      const r = await safeWrite("/tool/fetch", [
        `=url=https://${systemDomain}/api/hotspot-erro/${mikrotik.id}`,
        `=dst-path=${htmlDir}/error.html`,
        "=mode=https",
        "=check-certificate=no",
      ], FETCH_TIMEOUT);
      addStep("error_page", r === "timeout" ? "aviso" : "ok",
        r === "timeout" ? "error.html sem confirmacao (timeout); o login segue funcionando" : `error.html baixado em ${htmlDir}`);
    } catch (e) {
      addStep("error_page", "aviso", `error.html nao baixado: ${e.message}`);
    }

    try { await conn.close(); } catch (e) {}
    addStep("finalizado", "ok", "Configuracao concluida!");

    const hasErrors = steps.some(s => s.status === "erro");
    return { success: !hasErrors, steps, log: steps.map(s => `[${s.status}] ${s.message}`) };
  } catch (err) {
    addStep("fatal", "erro", err.message);
    try { await conn.close(); } catch (e) {}
    return { success: false, steps, log: steps.map(s => `[${s.status}] ${s.message}`), error: err.message };
  }
}

// Descobre o html-directory do hotspot ativo no MikroTik.
// Necessario porque nem todo MikroTik usa "hotspot/" — o caminho real
// vem do "html-directory" do hotspot profile vinculado ao server ativo.
// Fallback: "hotspot" (default do RouterOS).
async function resolveHotspotHtmlDir(conn) {
  try {
    const safePrint = (path, args = []) => Promise.race([
      conn.write(path, args).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(null), 10000))
    ]);

    const servers = await safePrint("/ip/hotspot/print");
    let profileName = null;
    if (Array.isArray(servers) && servers.length) {
      const active = servers.find(s => s.disabled !== "true" && s.invalid !== "true") || servers[0];
      profileName = active && active.profile;
    }
    if (!profileName) profileName = "default";

    const profiles = await safePrint("/ip/hotspot/profile/print");
    const prof = Array.isArray(profiles) ? profiles.find(p => p.name === profileName) : null;
    const htmlDir = prof && prof["html-directory"];
    if (htmlDir && String(htmlDir).trim()) return String(htmlDir).trim();
    return await dirPadraoPorArquivos(safePrint);
  } catch (e) {
    return "hotspot";
  }
}

// Se o profile nao pode ser lido (print expirou), decide pela estrutura de arquivos:
// modelos com memoria flash (ex.: hAP) usam "flash/hotspot"; os demais, "hotspot".
async function dirPadraoPorArquivos(safePrint) {
  try {
    const arquivos = await safePrint("/file/print", ["=.proplist=name"]);
    if (Array.isArray(arquivos) && arquivos.some(f => String(f.name || "").startsWith("flash/hotspot"))) {
      return "flash/hotspot";
    }
  } catch (e) { /* usa o padrao */ }
  return "hotspot";
}

/**
 * Aplica SO os padroes do hotspot (keepalive, interim-update, timeout RADIUS) em um equipamento
 * ja configurado, sem refazer o resto. Usado por "Aplicar padroes em todos".
 * @param {Object} mikrotik - linha de `mikrotiks`
 * @param {Function} [criarConexao] - (opcoes) => conexao RouterOS (injetavel nos testes)
 * @returns {Promise<{ok: boolean, mensagem: string}>}
 */
async function aplicarPadroesHotspot(mikrotik, criarConexao = (opcoes) => new RouterOSAPI(opcoes)) {
  const conn = criarConexao({
    host: mikrotik.ip,
    user: mikrotik.usuario,
    password: mikrotik.senha,
    port: mikrotik.porta || 8728,
    keepalive: false,
    timeout: 8000,
  });
  const avisos = [];
  try {
    await conn.connect();

    // Cada ajuste e' independente: um que falha nao impede os outros.
    const aplicar = async (nome, fn) => {
      try { await fn(); } catch (e) { if (e.errno !== "UNKNOWNREPLY") avisos.push(`${nome}: ${e.message}`); }
    };

    await aplicar("hotspot profile", () => conn.write("/ip/hotspot/profile/set", [
      "=numbers=hsprof-hotspot",
      `=radius-interim-update=${HOTSPOT_PADROES.radiusInterimUpdate}`,
      `=login-by=${HOTSPOT_PADROES.loginBy}`,
    ]));
    await aplicar("user profile", () => conn.write("/ip/hotspot/user/profile/set", [
      "=numbers=default",
      `=keepalive-timeout=${HOTSPOT_PADROES.keepaliveTimeout}`,
      `=idle-timeout=${HOTSPOT_PADROES.idleTimeout}`,
      "=add-mac-cookie=yes",
      `=mac-cookie-timeout=${HOTSPOT_PADROES.macCookieTimeout}`,
    ]));
    await aplicar("radius", async () => {
      const lista = await conn.write("/radius/print").catch(() => []);
      const cli = (Array.isArray(lista) ? lista : []).find((r) => r.service && String(r.service).includes("hotspot"));
      if (!cli) throw new Error("cliente RADIUS do hotspot nao encontrado");
      await conn.write("/radius/set", [`=.id=${cli[".id"]}`, `=timeout=${HOTSPOT_PADROES.radiusTimeout}`]);
      await desligarRequireMessageAuth((c, a) => conn.write(c, a), cli[".id"]);
    });
    await aplicar("hotspot server", async () => {
      const lista = await conn.write("/ip/hotspot/print").catch(() => []);
      for (const h of (Array.isArray(lista) ? lista : [])) {
        await conn.write("/ip/hotspot/set", [`=.id=${h[".id"]}`, `=addresses-per-mac=${HOTSPOT_PADROES.addressesPerMac}`]);
      }
    });

    return avisos.length
      ? { ok: false, mensagem: avisos.join(" | ") }
      : { ok: true, mensagem: "Padroes aplicados" };
  } catch (e) {
    return { ok: false, mensagem: `Falha ao conectar: ${e.message}` };
  } finally {
    try { await conn.close(); } catch { /* conexao ja caiu */ }
  }
}

module.exports = { configurarHotspot, configurarOnLogout, configurarDnsSeguro, prepararBridgeHotspot, sanitizarBridge, configurarWifiAP, ehInterfaceWifi, resolveHotspotHtmlDir, aplicarPadroesHotspot };
