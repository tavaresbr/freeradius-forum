const express = require("express")
require("../utils/routerosPatch"); // !empty do RouterOS 7 (ver utils/routerosPatch.js)
const router = express.Router()
const { mascararObjeto, preservarSegredos, semAlteracao } = require("../utils/segredos");
const db = require("../../db")
const { getDriver } = require("../gateways");
const { resolveHotspotHtmlDir, aplicarPadroesHotspot, ehInterfaceTunel } = require("../utils/hotspotSetup");
const { obterInformacoes } = require("../controllers/mikrotikAPIController");
const { exec } = require("child_process");
const { listarPeersDaEmpresa } = require("../controllers/wireguardController");
const { peersLivres } = require("../utils/vpnPeers");
const { credenciaisRoteador } = require("../utils/roteadorAdmin");
const { checarLimiteSeguro } = require("../utils/assinatura");
const { trilhaDaEmpresa } = require("../utils/trilhaAtivacao");
const { criarPlanoPadraoEquipamento } = require("../utils/empresaSetup");

// FreeRADIUS só lê NAS clients na inicialização, precisamos recarregar após mudanças
function reloadFreeRADIUS() {
  exec("systemctl restart freeradius", (err) => {
    if (err) console.error("⚠️ Erro ao reiniciar FreeRADIUS:", err.message);
    else console.log("✅ FreeRADIUS recarregado com novos NAS clients.");
  });
}
console.log("DEBUG obterInformacoes:", typeof obterInformacoes);

const TIPOS_GATEWAY = ["mikrotik", "omada", "unifi", "grandstream", "intelbras"];

/**
 * Valida e normaliza o body do cadastro/edicao de gateway por tipo.
 * Retorna { erro } ou { dados } prontos pro INSERT/UPDATE.
 *
 * Regras por tipo:
 *  - mikrotik: nome, ip, usuario, senha, porta (como sempre). Cria NAS (secret = senha).
 *  - omada: nome, ip, senha (secret RADIUS) — SEMPRE External RADIUS (decisao
 *    21/08/2026: modelo homologado; o portal nunca autoriza via API). Os campos
 *    controller_url/api_user/api_pass sao gerenciados pelos endpoints
 *    /:id/omada-api e servem SOMENTE pra capturar dados do controller (nomes
 *    dos APs) — nunca sao tocados pelo POST/PUT normal.
 *  - unifi: nome, ip, controller_url, api_user, api_pass. Sem NAS (API + polling,
 *    accounting RADIUS do UniFi nao e' confiavel — ver UnifiDriver).
 */
function validarGateway(body) {
  const tipo = TIPOS_GATEWAY.includes(body.tipo) ? body.tipo : "mikrotik";
  const {
    nome, ip, usuario, senha, porta, end_hotspot, portal_id,
    controller_url, controller_site, omadac_id, api_user, api_pass, verify_tls,
    gwn_api_key, gwn_api_secret, gwn_network_id,
  } = body;

  if (!nome || !ip) return { erro: "Nome e IP são obrigatórios." };

  if (tipo === "mikrotik") {
    if (!usuario || !senha || !porta) return { erro: "Usuário, senha e porta são obrigatórios para MikroTik." };
  } else if (tipo === "omada") {
    if (!senha) {
      return { erro: "Informe o Secret RADIUS (o mesmo cadastrado no RADIUS Profile do Omada)." };
    }
  } else if (tipo === "unifi") {
    if (!controller_url || !api_user || !api_pass) {
      return { erro: "Controller URL, usuário e senha do admin local são obrigatórios para UniFi." };
    }
  } else if (tipo === "grandstream") {
    // External RADIUS: so o secret e' obrigatorio. As chaves GWN Cloud sao
    // opcionais (monitoramento online/offline).
    if (!senha) {
      return { erro: "Informe o Secret RADIUS (o mesmo cadastrado no RADIUS do controller GWN)." };
    }
  } else if (tipo === "intelbras") {
    // AP standalone: External RADIUS puro, so o secret e' obrigatorio.
    if (!senha) {
      return { erro: "Informe o Secret RADIUS (o mesmo cadastrado no RADIUS do AP Intelbras)." };
    }
  }

  return {
    dados: {
      tipo,
      nome,
      ip,
      usuario: usuario || null,
      senha: senha || null,
      porta: porta || null,
      end_hotspot: end_hotspot || null,
      portal_id: portal_id || null,
      controller_url: controller_url || null,
      controller_site: controller_site || null,
      omadac_id: omadac_id || null,
      api_user: api_user || null,
      api_pass: api_pass || null,
      verify_tls: verify_tls === undefined ? 1 : (Number(verify_tls) ? 1 : 0),
      gwn_api_key: gwn_api_key || null,
      gwn_api_secret: gwn_api_secret || null,
      gwn_network_id: gwn_network_id || null,
    },
  };
}

/** O portal informado pertence a esta empresa? (portal_id vem do corpo: nunca confiar em id alheio) */
async function portalDaEmpresa(portalId, empresaId) {
  if (!portalId) return true;
  const [[p]] = await db.execute("SELECT id FROM portais WHERE id = ? AND empresa_id = ?", [portalId, empresaId]);
  return !!p;
}

/** Gateway usa FreeRADIUS (precisa de linha na tabela `nas`)? */
function usaRadius(dados) {
  // Omada e' SEMPRE External RADIUS — a API do controller (quando configurada
  // via /:id/omada-api) e' so' captura de dados, nao muda o fluxo do portal.
  // Grandstream tambem: External Web Portal + External RADIUS (o login_url do
  // GWN valida no nosso FreeRADIUS).
  // Intelbras (AP standalone) idem.
  return dados.tipo === "mikrotik" || dados.tipo === "omada" || dados.tipo === "grandstream" || dados.tipo === "intelbras";
}

/**
 * Middleware: bloqueia endpoints que falam RouterOS API direto (scan, enviar-hotspot,
 * enviar-login, enviar-status, info) quando o gateway nao e' MikroTik.
 */
async function somenteMikrotik(req, res, next) {
  try {
    const [[gw]] = await db.execute(
      "SELECT tipo FROM mikrotiks WHERE id = ? AND empresa_id = ?",
      [req.params.id, req.empresa_id]
    );
    if (!gw) return res.status(404).json({ message: "Gateway não encontrado." });
    if (gw.tipo && gw.tipo !== "mikrotik") {
      return res.status(400).json({ message: "Esta ação está disponível apenas para gateways MikroTik." });
    }
    next();
  } catch (err) {
    console.error("Erro no guard somenteMikrotik:", err);
    res.status(500).json({ message: "Erro interno." });
  }
}

// Criar Gateway (MikroTik / Omada / UniFi)
router.post("/", async (req, res) => {
  const { erro, dados } = validarGateway(req.body);
  if (erro) {
    console.log("⚠️ Validação de gateway falhou:", erro);
    return res.status(400).json({ message: erro });
  }

  try {
    const lim = await checarLimiteSeguro(req.empresa_id, "equipamentos");
    if (!lim.ok) return res.status(403).json({ message: lim.mensagem });

    if (!(await portalDaEmpresa(dados.portal_id, req.empresa_id))) {
      return res.status(400).json({ message: "Portal inválido." });
    }

    // Verificar se já existe gateway com esse IP na empresa
    const [existente] = await db.query("SELECT id FROM mikrotiks WHERE ip = ? AND empresa_id = ?", [dados.ip, req.empresa_id]);
    if (existente.length > 0) {
      return res.status(400).json({ message: "Já existe um gateway com este IP." });
    }

    if (usaRadius(dados)) {
      // Verificar se já existe NAS com esse IP
      const [nasExiste] = await db.query("SELECT id FROM nas WHERE nasname = ?", [dados.ip]);
      if (nasExiste.length > 0) {
        return res.status(400).json({ message: "Já existe um NAS com este IP." });
      }
    }

    const [insGw] = await db.execute(
      `INSERT INTO mikrotiks
        (empresa_id, nome, ip, usuario, senha, porta, end_hotspot, portal_id,
         tipo, controller_url, controller_site, omadac_id, api_user, api_pass, verify_tls,
         gwn_api_key, gwn_api_secret, gwn_network_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.empresa_id, dados.nome, dados.ip, dados.usuario, dados.senha, dados.porta,
        dados.end_hotspot, dados.portal_id, dados.tipo, dados.controller_url,
        dados.controller_site, dados.omadac_id, dados.api_user, dados.api_pass, dados.verify_tls,
        dados.gwn_api_key, dados.gwn_api_secret, dados.gwn_network_id,
      ]
    );

    // Planos padrao (LGPD/Lead) nascem sem equipamento: o primeiro cadastrado os assume.
    await db.execute(
      "UPDATE planos SET mikrotik_id = ? WHERE empresa_id = ? AND mikrotik_id IS NULL",
      [insGw.insertId, req.empresa_id]
    );

    // Todo equipamento novo ja nasce com o "Plano 60 minutos" gratis. Falha aqui nunca derruba o cadastro.
    try {
      await criarPlanoPadraoEquipamento(db, req.empresa_id, insGw.insertId, dados.nome);
    } catch (errPlano) {
      console.error("⚠️ Plano padrao do equipamento nao criado:", errPlano.message);
    }

    if (usaRadius(dados)) {
      // secret do NAS = campo senha (MikroTik: senha da API; Omada ext-RADIUS: secret RADIUS)
      await db.execute(
        "INSERT INTO nas (empresa_id, nasname, shortname, type, secret, description) VALUES (?, ?, ?, 'other', ?, 'RADIUS Client')",
        [req.empresa_id, dados.ip, dados.nome, dados.senha]
      );
      reloadFreeRADIUS();
    }

    console.log(`✅ Gateway ${dados.tipo} cadastrado com sucesso.`);
    res.status(201).json({ message: "Gateway cadastrado com sucesso." });

  } catch (err) {
    console.error("❌ Erro ao salvar gateway:", err);
    res.status(500).json({ message: "Erro interno ao salvar gateway." });
  }
});


// Peers da VPN desta empresa que ainda não viraram equipamento (IP em uso em mikrotiks).
// Usado pelo wizard "Adicionar Equipamento". Se o wg-easy estiver fora do ar, devolve lista
// vazia + aviso: o cadastro manual continua funcionando.
router.get("/vpn-disponiveis", async (req, res) => {
  try {
    const [usados] = await db.execute("SELECT ip FROM mikrotiks WHERE empresa_id = ?", [req.empresa_id]);
    let peers;
    try {
      peers = await listarPeersDaEmpresa(req.empresa_id);
    } catch (err) {
      console.error("Erro ao listar peers VPN:", err.message);
      return res.json({ peers: [], aviso: "Não foi possível consultar a VPN agora." });
    }
    const cred = credenciaisRoteador();
    res.json({ peers: peersLivres(peers, usados.map((r) => r.ip)), total: peers.length, ...(cred.senha ? { credenciais_padrao: cred } : {}) });
  } catch (err) {
    console.error("Erro em /vpn-disponiveis:", err.message);
    res.status(500).json({ message: "Erro ao buscar peers da VPN." });
  }
});

// Aplica os padroes do hotspot (keepalive, interim-update, timeout RADIUS) em TODOS os MikroTik da empresa.
// Um equipamento offline/com erro nao impede os outros.
router.post("/aplicar-padroes", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, nome, ip, usuario, senha, porta FROM mikrotiks WHERE empresa_id = ? AND tipo = 'mikrotik' ORDER BY id",
      [req.empresa_id]
    );
    const resultados = [];
    for (const m of rows) {
      const r = await aplicarPadroesHotspot(m);
      resultados.push({ id: m.id, nome: m.nome, ...r });
    }
    res.json({ resultados });
  } catch (err) {
    console.error("Erro em /aplicar-padroes:", err.message);
    res.status(500).json({ message: "Erro ao aplicar os padrões nos equipamentos." });
  }
});

// Trilha de ativacao (leitura barata: so consultas agregadas, sem RouterOS)
router.get("/trilha", async (req, res) => {
  try {
    res.json({ success: true, data: await trilhaDaEmpresa(db, req.empresa_id) });
  } catch (err) {
    console.error("Erro em /trilha:", err.message);
    res.status(500).json({ message: "Erro ao calcular a trilha de ativação." });
  }
});

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT m.*, p.nome as portal_nome, p.tipo as portal_tipo
      FROM mikrotiks m LEFT JOIN portais p ON m.portal_id = p.id
      WHERE m.empresa_id = ?
      ORDER BY m.id DESC
    `, [req.empresa_id]);
    // Segredos (senha/secret RADIUS, api_pass, chaves GWN) nunca vao ao navegador.
    res.json(rows.map(mascararObjeto))
  } catch (err) {
    res.status(500).json({ message: "Erro ao buscar Mikrotiks." })
  }
})


// Atualizar Gateway
router.put("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [[atual]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!atual) return res.status(404).json({ message: "Gateway não encontrado." });

    // Tipo e' travado na edicao (mudar tipo deixaria NAS/portal em estado inconsistente)
    // Segredo vazio/mascarado no corpo = manter o gravado (a lista devolve so a mascara).
    const { erro, dados } = validarGateway({ ...preservarSegredos(req.body, atual), tipo: atual.tipo || "mikrotik" });
    if (erro) return res.status(400).json({ message: erro });

    // Omada: os campos da API do controller sao gerenciados por /:id/omada-api —
    // a edicao normal PRESERVA o que ja esta salvo (senao toda edicao apagaria
    // a config de captura de nomes de APs).
    if (atual.tipo === "omada") {
      dados.controller_url = atual.controller_url;
      dados.controller_site = dados.controller_site || atual.controller_site;
      dados.omadac_id = atual.omadac_id;
      dados.api_user = atual.api_user;
      dados.api_pass = atual.api_pass;
      dados.verify_tls = atual.verify_tls;
    }

    if (!(await portalDaEmpresa(dados.portal_id, req.empresa_id))) {
      return res.status(400).json({ message: "Portal inválido." });
    }
    // Trocar para o IP que ja e NAS de outra empresa tomaria o NAS (IP + secret) dela.
    if (usaRadius(dados) && String(dados.ip).trim() !== String(atual.ip || "").trim()) {
      const [nasDono] = await db.execute("SELECT id FROM nas WHERE nasname = ? LIMIT 1", [dados.ip]);
      if (nasDono.length > 0) return res.status(400).json({ message: "Já existe um NAS com este IP." });
    }

    await db.execute(
      `UPDATE mikrotiks SET
         nome = ?, ip = ?, usuario = ?, senha = ?, porta = ?, end_hotspot = ?, portal_id = ?,
         controller_url = ?, controller_site = ?, omadac_id = ?, api_user = ?, api_pass = ?, verify_tls = ?,
         gwn_api_key = ?, gwn_api_secret = ?, gwn_network_id = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        dados.nome, dados.ip, dados.usuario, dados.senha, dados.porta, dados.end_hotspot, dados.portal_id,
        dados.controller_url, dados.controller_site, dados.omadac_id, dados.api_user, dados.api_pass, dados.verify_tls,
        dados.gwn_api_key, dados.gwn_api_secret, dados.gwn_network_id,
        id, req.empresa_id,
      ]
    );

    const ipAntigo = String(atual.ip || "").trim();
    if (usaRadius(dados)) {
      // Upsert do NAS pelo IP antigo (cobre troca de IP e gateway sem NAS previo).
      // Sempre escopado por empresa: o NAS (IP + secret) de outra empresa nunca pode ser alterado aqui.
      const [upd] = await db.execute(
        "UPDATE nas SET nasname = ?, shortname = ?, secret = ? WHERE nasname = ? AND (empresa_id = ? OR empresa_id IS NULL)",
        [dados.ip, dados.nome, dados.senha, ipAntigo, req.empresa_id]
      );
      if (upd.affectedRows === 0) {
        await db.execute(
          "INSERT INTO nas (empresa_id, nasname, shortname, type, secret, description) VALUES (?, ?, ?, 'other', ?, 'RADIUS Client')",
          [req.empresa_id, dados.ip, dados.nome, dados.senha]
        );
      }
      reloadFreeRADIUS();
    } else {
      // Gateway que nao usa RADIUS (unifi / omada modo API): remove NAS orfao se existir
      const [del] = await db.execute(
        "DELETE FROM nas WHERE nasname = ? AND (empresa_id = ? OR empresa_id IS NULL)", [ipAntigo, req.empresa_id]
      );
      if (del.affectedRows > 0) reloadFreeRADIUS();
    }

    res.json({ message: "Atualizado com sucesso." });
  } catch (err) {
    console.error("❌ Erro ao atualizar gateway/NAS:", err);
    res.status(500).json({ message: "Erro ao atualizar gateway." });
  }
});


// ============================================================================
// API do controller Omada — SOMENTE captura de dados (nomes dos APs).
// O portal continua 100% External RADIUS independente desta config.
// ============================================================================
const { descobrirInfo, sincronizarApsOmada } = require("../services/omadaApNames");

async function buscarGatewayOmada(req, res) {
  const [[gw]] = await db.execute(
    "SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?",
    [req.params.id, req.empresa_id]
  );
  if (!gw) { res.status(404).json({ message: "Gateway não encontrado." }); return null; }
  if (gw.tipo !== "omada") { res.status(400).json({ message: "Disponível apenas para gateways Omada." }); return null; }
  return gw;
}

// Salvar config da API + testar + sincronizar APs
router.put("/:id/omada-api", async (req, res) => {
  try {
    const gw = await buscarGatewayOmada(req, res);
    if (!gw) return;

    const controller_url = String(req.body.controller_url || "").trim().replace(/\/+$/, "");
    const api_user = String(req.body.api_user || "").trim();
    const api_pass = semAlteracao(req.body.api_pass) ? (gw.api_pass || "") : req.body.api_pass;
    const verify_tls = Number(req.body.verify_tls) ? 1 : 0;
    if (!controller_url || !api_user || !api_pass) {
      return res.status(400).json({ message: "Informe URL do controller, usuário e senha do admin local." });
    }

    // Auto-descobre o omadacId (tambem valida que a URL e' mesmo um controller)
    let info;
    try {
      info = await descobrirInfo(controller_url, verify_tls);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    await db.execute(
      `UPDATE mikrotiks SET controller_url = ?, omadac_id = ?, api_user = ?, api_pass = ?, verify_tls = ?
       WHERE id = ? AND empresa_id = ?`,
      [controller_url, info.omadacId, api_user, api_pass, verify_tls, gw.id, req.empresa_id]
    );

    // Testa login + sincroniza os nomes dos APs na hora
    const [[gwAtualizado]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ?", [gw.id]);
    try {
      const r = await sincronizarApsOmada(gwAtualizado);
      res.json({
        message: `API configurada. ${r.total} AP(s) sincronizados do site "${r.site}".`,
        controller_ver: info.controllerVer,
        ...r,
      });
    } catch (err) {
      // Config salva mas sync falhou (ex.: credencial errada) — reporta claro
      res.status(400).json({ message: `Config salva, mas a sincronização falhou: ${err.message}` });
    }
  } catch (err) {
    console.error("Erro ao configurar API Omada:", err);
    res.status(500).json({ message: "Erro interno ao configurar API do Omada." });
  }
});

// Remover config da API (para de capturar; nomes ja importados permanecem)
router.delete("/:id/omada-api", async (req, res) => {
  try {
    const gw = await buscarGatewayOmada(req, res);
    if (!gw) return;
    await db.execute(
      `UPDATE mikrotiks SET controller_url = NULL, omadac_id = NULL, api_user = NULL, api_pass = NULL
       WHERE id = ? AND empresa_id = ?`,
      [gw.id, req.empresa_id]
    );
    res.json({ message: "API do controller removida. Os nomes de APs já importados foram mantidos." });
  } catch (err) {
    console.error("Erro ao remover API Omada:", err);
    res.status(500).json({ message: "Erro interno ao remover API do Omada." });
  }
});

// Sincronizar nomes dos APs agora (manual)
router.post("/:id/sincronizar-aps", async (req, res) => {
  try {
    const gw = await buscarGatewayOmada(req, res);
    if (!gw) return;
    const r = await sincronizarApsOmada(gw);
    res.json({ message: `${r.total} AP(s) sincronizados do site "${r.site}".`, ...r });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Deletar Mikrotik
// Deletar Mikrotik e correspondente na tabela NAS
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar IP do Mikrotik
    const [[mikrotik]] = await db.execute("SELECT ip FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado." });

    const ip = mikrotik.ip.trim();

    // Deletar Mikrotik
    await db.execute("DELETE FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);

    // Verificar se existe NAS com esse IP antes de tentar remover
    const [nas] = await db.execute(
      "SELECT id FROM nas WHERE nasname = ? AND (empresa_id = ? OR empresa_id IS NULL)", [ip, req.empresa_id]
    );
    if (nas.length > 0) {
      await db.execute("DELETE FROM nas WHERE nasname = ? AND (empresa_id = ? OR empresa_id IS NULL)", [ip, req.empresa_id]);
      console.log(`✅ NAS com IP ${ip} removido.`);
    } else {
      console.warn(`⚠️ Nenhum NAS encontrado com IP ${ip}`);
    }

    reloadFreeRADIUS();
    res.json({ message: "Removido com sucesso." });
  } catch (err) {
    console.error("❌ Erro ao deletar Mikrotik/NAS:", err);
    res.status(500).json({ message: "Erro ao deletar Mikrotik." });
  }
});

router.post("/:id/testar", async (req, res) => {
  const { id } = req.params;
  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });

    const resultado = await getDriver(mikrotik).testConnection(mikrotik);

    if (resultado.sucesso) {
      res.json({ status: "online", message: resultado.aviso || "Conexão bem-sucedida" });
    } else {
      res.status(400).json({ status: "offline", message: resultado.erro });
    }
  } catch (err) {
    console.error("Erro ao testar Mikrotik:", err);
    res.status(500).json({ message: "Erro interno ao testar Mikrotik" });
  }
});


router.post("/:id/info", somenteMikrotik, obterInformacoes);

// Escanear Mikrotik para obter interfaces, pools e IPs
router.post("/:id/scan", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });

    const { RouterOSAPI } = require("node-routeros");
    const conn = new RouterOSAPI({
      host: mikrotik.ip,
      user: mikrotik.usuario,
      password: mikrotik.senha,
      port: mikrotik.porta || 8728,
      keepalive: false,
      timeout: 10000,
    });

    await conn.connect();

    // node-routeros !empty bug: Promise never resolves on empty lists
    // Use Promise.race with timeout to handle this
    const timedQuery = (path, timeoutMs = 3000) => {
      return Promise.race([
        conn.write(path).then(r => Array.isArray(r) ? r : []).catch(() => []),
        new Promise(resolve => setTimeout(() => resolve([]), timeoutMs))
      ]);
    };

    const result = { interfaces: [], pools: [], addresses: [], hotspots: [], profiles: [], radius: [] };

    // Interfaces e addresses sempre existem
    const interfaces = await timedQuery("/interface/print");
    // WAN (dhcp-client / pppoe / rota default) e portas de bridge nao servem para hotspot
    const dhcpClients = await timedQuery("/ip/dhcp-client/print");
    const pppoeClients = await timedQuery("/interface/pppoe-client/print");
    const rotas = await timedQuery("/ip/route/print");
    const bridgePorts = await timedQuery("/interface/bridge/port/print");
    const wanIfs = new Set([
      ...dhcpClients.map(d => d.interface),
      ...pppoeClients.map(p => p.interface),
      ...rotas
        .filter(r => r["dst-address"] === "0.0.0.0/0")
        .map(r => ((r["gateway-status"] || "").match(/via\s+(\S+)/) || [])[1] || r.gateway),
    ].filter(Boolean));
    const bridgeIfs = new Set(bridgePorts.map(b => b.interface));
    result.interfaces = interfaces.map(i => ({
      name: i.name, type: i.type, disabled: i.disabled,
      wan: wanIfs.has(i.name), bridge: bridgeIfs.has(i.name), tunel: ehInterfaceTunel(i.name, i.type),
    }));

    const addresses = await timedQuery("/ip/address/print");
    result.addresses = addresses.map(a => ({ address: a.address, interface: a.interface, network: a.network }));

    // Pools, hotspot, profiles, radius podem estar vazios (!empty)
    const pools = await timedQuery("/ip/pool/print");
    result.pools = pools.map(p => ({ name: p.name, ranges: p.ranges }));

    const hotspots = await timedQuery("/ip/hotspot/print");
    result.hotspots = hotspots.map(h => ({ name: h.name, interface: h.interface, profile: h.profile }));

    const profiles = await timedQuery("/ip/hotspot/profile/print");
    result.profiles = profiles.map(p => ({ name: p.name }));

    const radiusList = await timedQuery("/radius/print");
    result.radius = radiusList.map(r => ({ address: r.address, service: r.service }));

    try { await conn.close(); } catch (e) {}

    res.json(result);
  } catch (err) {
    console.error("Erro ao escanear Mikrotik:", err.message);
    res.status(500).json({ message: "Erro ao escanear: " + err.message });
  }
});

// Enviar configuração completa de Hotspot para o Mikrotik (SSE - streaming de steps)
// Uma execucao do assistente por equipamento: duas ao mesmo tempo (aba reaberta, clique duplo) enchem a
// API do roteador lento e geram falsos timeouts/duplicatas. A execucao continua mesmo se o navegador cair.
const hotspotEmExecucao = new Set();
router.post("/:id/enviar-hotspot", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  const config = req.body;
  const chaveExecucao = `${req.empresa_id}:${id}`;
  if (hotspotEmExecucao.has(chaveExecucao)) {
    return res.status(409).json({ message: "O assistente já está rodando neste equipamento. Aguarde terminar." });
  }
  hotspotEmExecucao.add(chaveExecucao);

  // Configurar SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Desabilitar buffering do Nginx
  });

  const sendEvent = (data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat: passos lentos (download do login.html) ficam minutos sem enviar
  // nada e o proxy fecha a conexao ociosa ("network error" no navegador).
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, 10000);
  res.on("close", () => clearInterval(heartbeat));

  try {
    const [[mikrotik]] = await db.execute(
      "SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!mikrotik) {
      clearInterval(heartbeat);
      hotspotEmExecucao.delete(chaveExecucao);
      sendEvent({ type: "error", message: "Mikrotik não encontrado" });
      res.end();
      return;
    }

    let portal = null;
    if (mikrotik.portal_id) {
      const [[p]] = await db.execute("SELECT * FROM portais WHERE id = ?", [mikrotik.portal_id]);
      portal = p;
    }

    const [[empresa]] = await db.execute("SELECT id, slug FROM empresas WHERE id = ?", [req.empresa_id]);

    const systemDomain = req.headers.host?.replace(/:\d+$/, "") || process.env.SYSTEM_DOMAIN;
    const { configurarHotspot } = require("../utils/hotspotSetup");

    // Callback chamado a cada step - envia em tempo real via SSE
    const onStep = (step) => {
      sendEvent({ type: "step", ...step });
    };

    const { portalHostDaEmpresa } = require("../utils/dominioPortal");
    const portalHost = await portalHostDaEmpresa(req.empresa_id).catch(() => null);
    const result = await configurarHotspot(
      mikrotik, portal, systemDomain.replace(/:\d+$/, ""), config, empresa || {}, onStep, portalHost
    );

    // Atualizar end_hotspot
    // IMPORTANTE: priorizar dnsName (DNS Name do Server Profile do hotspot) sobre o IP.
    // O MikroTik usa esse DNS Name como destino dos redirects HTTP do captive portal.
    // Quando salvamos o IP cru aqui, o cliente as vezes nao consegue logar (problema
    // de redirect HTTPS sem cert valido para o IP). Usando o DNS Name, o redirect
    // bate em algo que tem cert e roteamento certo.
    const localAddr = config.localAddress || "10.5.50.1/24";
    const gatewayIp = localAddr.split("/")[0];
    const endHotspot = (config.dnsName && config.dnsName.trim()) || gatewayIp;
    // So grava se o assistente terminou sem erro: antes gravava sempre e a trilha de ativacao ficava
    // verde com o roteador vazio (caso RB08).
    if (result.success) {
      await db.execute(
        "UPDATE mikrotiks SET end_hotspot = ? WHERE id = ? AND empresa_id = ?",
        [endHotspot, id, req.empresa_id]
      );
    }

    // Evento final
    sendEvent({
      type: "done",
      success: result.success,
      end_hotspot: endHotspot,
    });
  } catch (err) {
    console.error("Erro ao enviar hotspot:", err);
    sendEvent({ type: "error", message: "Erro interno: " + err.message });
  }

  hotspotEmExecucao.delete(chaveExecucao);
  clearInterval(heartbeat);
  res.end();
});

// Diagnostico do hotspot em um clique (so leitura): ver utils/diagnosticoHotspot.js
const abrirConexaoDiagnostico = async (mikrotik) => {
  const { RouterOSAPI } = require("node-routeros");
  const conn = new RouterOSAPI({
    host: mikrotik.ip, user: mikrotik.usuario, password: mikrotik.senha,
    port: mikrotik.porta || 8728, keepalive: false, timeout: 15,
  });
  conn.on("error", () => {});
  await conn.connect();
  return conn;
};
const diagnosticoEmAndamento = new Set();
router.post("/:id/diagnostico-hotspot", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  let conn;
  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });
    if (diagnosticoEmAndamento.has(mikrotik.id)) return res.status(409).json({ message: "Já existe um diagnóstico em andamento para este equipamento." });
    diagnosticoEmAndamento.add(mikrotik.id);
    try {
      conn = await abrirConexaoDiagnostico(mikrotik);
      // Leitura que distingue lista vazia (ok, []) de leitura que expirou (ok:false): nunca vira "nao existe".
      const ler = (path, args = []) => Promise.race([
        conn.write(path, args).then((r) => ({ ok: true, itens: Array.isArray(r) ? r : [] })).catch(() => ({ ok: false, itens: [] })),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, itens: [] }), 8000)),
      ]);
      const { portalHostDaEmpresa } = require("../utils/dominioPortal");
      const portalHost = (await portalHostDaEmpresa(req.empresa_id).catch(() => null)) || process.env.SYSTEM_DOMAIN || "";
      const dns = require("dns").promises;
      const resolve = async (host) => { try { await dns.lookup(host); return true; } catch (e) { return false; } };
      const { diagnosticarHotspot } = require("../utils/diagnosticoHotspot");
      const r = await diagnosticarHotspot({ ler, mikrotik, portalHost, resolve });
      return res.json({ success: true, ...r });
    } finally {
      diagnosticoEmAndamento.delete(mikrotik.id);
      if (conn) { try { await conn.close(); } catch (e) {} }
    }
  } catch (err) {
    const { descreverErro } = require("../utils/mikrotikClient");
    console.error("Erro no diagnostico do hotspot:", err.message);
    res.status(500).json({ message: "Não foi possível diagnosticar: " + descreverErro(err) });
  }
});

// Nome do Wi-Fi (SSID) de um equipamento ja configurado: le os radios e troca so o nome.
const wifiEmAndamento = new Set();
const withWifi = async (req, res, fn) => {
  const { id } = req.params;
  let conn;
  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });
    if (wifiEmAndamento.has(mikrotik.id)) return res.status(409).json({ message: "Já existe uma operação de Wi-Fi em andamento para este equipamento." });
    wifiEmAndamento.add(mikrotik.id);
    try {
      conn = await abrirConexaoDiagnostico(mikrotik);
      const ler = (path) => Promise.race([
        conn.write(path).then((r) => ({ ok: true, itens: Array.isArray(r) ? r : [] })).catch(() => ({ ok: false, itens: [] })),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, itens: [] }), 8000)),
      ]);
      const escrever = (path, args) => Promise.race([
        conn.write(path, args),
        new Promise((_, rej) => setTimeout(() => rej(new Error("sem resposta do roteador")), 30000)),
      ]);
      return await fn({ ler, escrever });
    } finally {
      wifiEmAndamento.delete(mikrotik.id);
      if (conn) { try { await conn.close(); } catch (e) {} }
    }
  } catch (err) {
    const { descreverErro } = require("../utils/mikrotikClient");
    console.error("Erro no Wi-Fi do equipamento:", err.message);
    res.status(500).json({ message: "Não foi possível acessar o Wi-Fi: " + descreverErro(err) });
  }
};

router.post("/:id/wifi", somenteMikrotik, (req, res) => withWifi(req, res, async ({ ler }) => {
  const { lerWifi } = require("../utils/hotspotSetup");
  const r = await lerWifi({ ler });
  res.json({ success: r.ok, ...r });
}));

router.put("/:id/wifi", somenteMikrotik, (req, res) => withWifi(req, res, async ({ ler, escrever }) => {
  const { renomearWifi, validarSsid } = require("../utils/hotspotSetup");
  const body = req.body || {};
  const v = validarSsid(body.ssid);
  if (!v.ok) return res.status(400).json({ message: v.message });
  const radios = Array.isArray(body.radios) ? body.radios.filter((r) => typeof r === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(r)) : [];
  if (radios.length === 0 || radios.length > 8) return res.status(400).json({ message: "Escolha de 1 a 8 radios." });
  const r = await renomearWifi({ radios: [...new Set(radios)], ssid: v.nome, ler, escrever });
  res.status(r.status === "erro" && !r.radios.length ? 409 : 200).json({ success: r.status !== "erro", ...r });
}));

// Correcoes seguras e idempotentes sugeridas pelo diagnostico (cada uma com confirmacao no front).
router.post("/:id/corrigir-hotspot", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  const acao = String(req.body && req.body.acao || "");
  if (!["dns_dhcp", "dns_remoto", "dns_name", "end_hotspot", "reset_html"].includes(acao)) return res.status(400).json({ message: "Ação inválida" });
  let conn;
  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });
    conn = await abrirConexaoDiagnostico(mikrotik);
    const lista = async (path) => { try { const r = await conn.write(path); return Array.isArray(r) ? r : []; } catch (e) { return []; } };
    const hs = (await lista("/ip/hotspot/print")).find((h) => h.name === "hotspot1");
    const ifName = hs && hs.interface;
    const ip = ifName ? (await lista("/ip/address/print")).find((a) => a.interface === ifName) : null;
    const gateway = ip ? String(ip.address).split("/")[0] : "";
    const { calcularRede } = require("../utils/redeHotspot");
    const rede = ip ? calcularRede(ip.address) : null;
    let mensagem = "";

    if (acao === "reset_html") {
      if (!hs) return res.status(409).json({ message: "Servidor hotspot1 não encontrado no roteador. Rode o assistente 'Hotspot'." });
      // reset-html exige o servidor do hotspot em "numbers" (o numero/nome do servidor, nao a pasta)
      await conn.write("/ip/hotspot/reset-html", [`=numbers=${hs.name}`]);
      mensagem = "Paginas padrao do hotspot restauradas. O login.html e o error.html voltaram ao padrao do MikroTik: clique em 'Login' (ou 'Enviar hotspot') na linha do equipamento para regrava-los.";
    } else if (acao === "dns_remoto") {
      await conn.write("/ip/dns/set", ["=allow-remote-requests=yes"]);
      mensagem = "DNS do roteador habilitado para os clientes.";
    } else if (!gateway) {
      return res.status(409).json({ message: "Não encontrei o IP do hotspot no roteador. Rode o assistente 'Hotspot'." });
    } else if (acao === "dns_dhcp") {
      const nets = await lista("/ip/dhcp-server/network/print");
      const rn = nets.find((n) => rede && rede.ok && n.address === rede.network) || nets.find((n) => n.gateway === gateway);
      if (rn) await conn.write("/ip/dhcp-server/network/set", [`=.id=${rn[".id"]}`, `=dns-server=${gateway}`]);
      else await conn.write("/ip/dhcp-server/network/add", [`=address=${rede && rede.ok ? rede.network : ip.network + "/24"}`, `=gateway=${gateway}`, `=dns-server=${gateway}`]);
      mensagem = `O DHCP agora entrega ${gateway} como DNS. Peça para os aparelhos esquecerem a rede e conectarem de novo.`;
    } else if (acao === "dns_name") {
      const profs = await lista("/ip/hotspot/profile/print");
      const prof = profs.find((p) => p.name === (hs && hs.profile)) || profs.find((p) => p.name === "hsprof-hotspot");
      if (!prof) return res.status(409).json({ message: "Perfil do hotspot não encontrado." });
      await conn.write("/ip/hotspot/profile/set", [`=.id=${prof[".id"]}`, "=dns-name="]);
      await db.execute("UPDATE mikrotiks SET end_hotspot = ? WHERE id = ? AND empresa_id = ?", [gateway, id, req.empresa_id]);
      mensagem = `dns-name removido; o hotspot usa ${gateway} e o cadastro foi atualizado.`;
    } else if (acao === "end_hotspot") {
      const profs = await lista("/ip/hotspot/profile/print");
      const prof = profs.find((p) => p.name === (hs && hs.profile)) || profs.find((p) => p.name === "hsprof-hotspot");
      const dnsName = prof && String(prof["dns-name"] || "").trim();
      const valor = dnsName || gateway;
      await db.execute("UPDATE mikrotiks SET end_hotspot = ? WHERE id = ? AND empresa_id = ?", [valor, id, req.empresa_id]);
      mensagem = `Destino do login final gravado: ${valor}.`;
    }
    res.json({ success: true, message: mensagem });
  } catch (err) {
    const { descreverErro } = require("../utils/mikrotikClient");
    console.error("Erro ao corrigir hotspot:", err.message);
    res.status(500).json({ message: "Não foi possível corrigir: " + descreverErro(err) });
  } finally {
    if (conn) { try { await conn.close(); } catch (e) {} }
  }
});

// Enviar apenas login.html para o Mikrotik (sem reconfigurar hotspot)
router.post("/:id/enviar-login", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  try {
    const [[mikrotik]] = await db.execute(
      "SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });

    const { RouterOSAPI } = require("node-routeros");
    const conn = new RouterOSAPI({
      host: mikrotik.ip,
      user: mikrotik.usuario,
      password: mikrotik.senha,
      port: mikrotik.porta || 8728,
      keepalive: false,
      timeout: 20000,
    });

    await conn.connect();

    const systemDomain = req.headers.host?.replace(/:\d+$/, "") || process.env.SYSTEM_DOMAIN;
    const fetchUrl = `https://${systemDomain}/api/hotspot-login/${mikrotik.id}`;

    const safeWrite = (path, args) => {
      return Promise.race([
        conn.write(path, args).catch(e => e.message),
        new Promise(resolve => setTimeout(() => resolve("timeout"), 20000))
      ]);
    };

    // Resolve html-directory real do profile ativo (fallback: "hotspot").
    const htmlDir = await resolveHotspotHtmlDir(conn);
    const dstPath = `${htmlDir}/login.html`;

    let ok = false;
    let mensagem = "";

    // Tentar HTTPS
    try {
      const r = await safeWrite("/tool/fetch", [
        `=url=${fetchUrl}`,
        `=dst-path=${dstPath}`,
        "=mode=https",
        "=check-certificate=no",
      ]);
      if (r !== "timeout") {
        ok = true;
        mensagem = `login.html enviado em ${dstPath} (HTTPS)`;
      }
    } catch (e) { /* tenta HTTP */ }

    // Fallback HTTP
    if (!ok) {
      try {
        const r = await safeWrite("/tool/fetch", [
          `=url=http://${systemDomain}/api/hotspot-login/${mikrotik.id}`,
          `=dst-path=${dstPath}`,
          "=mode=http",
        ]);
        if (r !== "timeout") {
          ok = true;
          mensagem = `login.html enviado em ${dstPath} (HTTP)`;
        }
      } catch (e) { /* fallback manual */ }
    }

    try { await conn.close(); } catch (e) {}

    if (ok) {
      res.json({ success: true, message: mensagem });
    } else {
      const [[empresa]] = await db.execute("SELECT id, slug FROM empresas WHERE id = ?", [req.empresa_id]);
      const empresaId = empresa?.id || mikrotik.empresa_id || '';
      const empresaSlug = empresa?.slug || 'default';
      const fallbackUrl = `https://${systemDomain}/hotspot/redirect/${mikrotik.id}?mac=$(mac)&ip=$(ip)&mikrotik_id=${mikrotik.id}&empresa_id=${empresaId}&empresa=${empresaSlug}`;
      res.status(207).json({
        success: false,
        message: `Não conseguiu baixar automaticamente. Substitua ${dstPath} manualmente com redirect para: ${fallbackUrl}`
      });
    }
  } catch (err) {
    console.error("Erro ao enviar login.html:", err.message);
    res.status(500).json({ message: "Erro ao conectar: " + err.message });
  }
});

// Enviar status.html para o Mikrotik (sem reconfigurar hotspot)
router.post("/:id/enviar-status", somenteMikrotik, async (req, res) => {
  const { id } = req.params;
  try {
    const [[mikrotik]] = await db.execute(
      "SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });

    const { RouterOSAPI } = require("node-routeros");
    const conn = new RouterOSAPI({
      host: mikrotik.ip,
      user: mikrotik.usuario,
      password: mikrotik.senha,
      port: mikrotik.porta || 8728,
      keepalive: false,
      timeout: 20000,
    });

    await conn.connect();

    const systemDomain = req.headers.host?.replace(/:\d+$/, "") || process.env.SYSTEM_DOMAIN;
    const fetchUrl = `https://${systemDomain}/api/hotspot-status/${mikrotik.id}`;

    const safeWrite = (path, args) => {
      return Promise.race([
        conn.write(path, args).catch(e => e.message),
        new Promise(resolve => setTimeout(() => resolve("timeout"), 20000))
      ]);
    };

    // Resolve html-directory real do profile ativo (fallback: "hotspot").
    const htmlDir = await resolveHotspotHtmlDir(conn);
    const dstPath = `${htmlDir}/status.html`;

    let ok = false;
    let mensagem = "";

    // Tentar HTTPS
    try {
      const r = await safeWrite("/tool/fetch", [
        `=url=${fetchUrl}`,
        `=dst-path=${dstPath}`,
        "=mode=https",
        "=check-certificate=no",
      ]);
      if (r !== "timeout") {
        ok = true;
        mensagem = `status.html enviado em ${dstPath} (HTTPS)`;
      }
    } catch (e) { /* tenta HTTP */ }

    // Fallback HTTP
    if (!ok) {
      try {
        const r = await safeWrite("/tool/fetch", [
          `=url=http://${systemDomain}/api/hotspot-status/${mikrotik.id}`,
          `=dst-path=${dstPath}`,
          "=mode=http",
        ]);
        if (r !== "timeout") {
          ok = true;
          mensagem = `status.html enviado em ${dstPath} (HTTP)`;
        }
      } catch (e) { /* fallback */ }
    }

    try { await conn.close(); } catch (e) {}

    if (ok) {
      res.json({ success: true, message: mensagem });
    } else {
      res.status(207).json({
        success: false,
        message: `Não conseguiu enviar ${dstPath} automaticamente. Baixe manualmente de: ${fetchUrl}`
      });
    }
  } catch (err) {
    console.error("Erro ao enviar status.html:", err.message);
    res.status(500).json({ message: "Erro ao conectar: " + err.message });
  }
});

module.exports = router
