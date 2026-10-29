const axios = require("axios");
const db = require("../../db");
const { mascarar } = require("../utils/segredos");

// Fallback global do .env (usado se empresa nao tiver config propria)
const DEFAULT_API_URL = process.env.EVOLUTION_API_URL || "http://localhost:8080";
const DEFAULT_API_KEY = process.env.EVOLUTION_API_KEY || "";
const DEFAULT_INSTANCE = process.env.EVOLUTION_INSTANCE || "hotspot";

function formatarNumeroComNonoDigito(numero) {
    const regex = /^55(\d{2})(\d{8,9})$/;
    const match = numero.match(regex);
    if (!match) return numero;
    const ddd = parseInt(match[1], 10);
    let numeroFinal = match[2];
    if (ddd <= 30 && numeroFinal.length === 8) {
      numeroFinal = '9' + numeroFinal;
    } else if (ddd > 30 && numeroFinal.length === 9 && numeroFinal.startsWith('9')) {
      numeroFinal = numeroFinal.slice(1);
    }
    return `55${ddd}${numeroFinal}`;
}

// Busca config da Evolution API por empresa.
// IMPORTANTE (multi-tenant): se a empresa nao tem config propria, NAO cai
// no DEFAULT_INSTANCE global — isso vazaria a instancia do servidor master
// para outras empresas. Em vez disso, usa um nome unico por empresa
// (`empresa_${id}`), que ainda nao existe na Evolution API, fazendo com que
// o frontend exiba a tela de "criar instancia".
// O DEFAULT_INSTANCE global so e usado quando NAO ha empresa_id no contexto
// (ex: chamadas internas/scripts sem tenant).
async function getEvolutionConfig(empresaId) {
  if (empresaId) {
    const [[config]] = await db.query(
      "SELECT config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'",
      [empresaId]
    );
    if (config) {
      const cfg = typeof config.config_json === 'string' ? JSON.parse(config.config_json) : config.config_json;
      // URL propria so vale junto com chave propria (par definido pela plataforma). Sem isso a chave
      // global iria para um host escolhido pela empresa (vazamento da chave + SSRF).
      const servidorProprio = !!cfg.api_key && cfg.api_key !== DEFAULT_API_KEY && !!cfg.api_url;
      return {
        apiUrl: servidorProprio ? cfg.api_url : DEFAULT_API_URL,
        apiKey: servidorProprio ? cfg.api_key : DEFAULT_API_KEY,
        instanceName: cfg.instance_name || `empresa_${empresaId}`,
      };
    }
    // Empresa sem config: nome de instancia exclusivo, sem cair no global.
    return {
      apiUrl: DEFAULT_API_URL,
      apiKey: DEFAULT_API_KEY,
      instanceName: `empresa_${empresaId}`,
    };
  }
  // Sem empresa_id (chamada interna sem tenant): fallback global.
  return { apiUrl: DEFAULT_API_URL, apiKey: DEFAULT_API_KEY, instanceName: DEFAULT_INSTANCE };
}

// Helper para headers da Evolution API
function evoHeaders(apiKey) {
  return { apikey: apiKey, "Content-Type": "application/json" };
}

// === Envio de mensagens ===

async function enviarMensagem(req, res) {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) {
    return res.status(400).json({ error: "Telefone e mensagem sao obrigatorios." });
  }

  const evo = await getEvolutionConfig(req.empresa_id);
  const numeroFormatado = formatarNumeroComNonoDigito(telefone);

  try {
    const resposta = await axios.post(
      `${evo.apiUrl}/message/sendText/${evo.instanceName}`,
      { number: numeroFormatado, text: mensagem },
      { headers: evoHeaders(evo.apiKey) }
    );
    return res.json({ sucesso: true, data: resposta.data });
  } catch (err) {
    console.error("Erro ao enviar mensagem Evolution API:", err?.response?.data || err.message);
    return res.status(500).json({ error: "Erro ao enviar mensagem via Evolution API." });
  }
}

// Funcao direta para envio interno (sem req/res, chamada pelo liberarUsuario)
async function enviarMensagemDireta(telefone, mensagem, empresaId) {
  const evo = await getEvolutionConfig(empresaId);
  if (!telefone || !mensagem || !evo.apiKey) return;

  const numeroFormatado = formatarNumeroComNonoDigito(telefone);

  const resposta = await axios.post(
    `${evo.apiUrl}/message/sendText/${evo.instanceName}`,
    { number: numeroFormatado, text: mensagem },
    { headers: evoHeaders(evo.apiKey) }
  );
  return resposta.data;
}

// Envio estrito (promocoes): ao contrario de enviarMensagemDireta, NUNCA devolve sucesso sem enviar
// (sem apiKey/telefone/mensagem lanca erro), para a fila nao marcar "enviado" o que nao saiu.
async function enviarMensagemEstrita(telefone, mensagem, empresaId) {
  const evo = await getEvolutionConfig(empresaId);
  if (!evo.apiKey) throw new Error("WhatsApp sem chave de API configurada");
  if (!telefone || !mensagem) throw new Error("Telefone ou mensagem vazios");
  const resposta = await axios.post(
    `${evo.apiUrl}/message/sendText/${evo.instanceName}`,
    { number: formatarNumeroComNonoDigito(telefone), text: mensagem },
    { headers: evoHeaders(evo.apiKey), timeout: 20000 }
  );
  return resposta.data;
}

// A instancia da empresa existe e esta conectada (state "open")? Usado pelo worker de promocoes.
async function instanciaConectada(empresaId) {
  try {
    const evo = await getEvolutionConfig(empresaId);
    if (!evo.apiKey) return false;
    const r = await axios.get(
      `${evo.apiUrl}/instance/connectionState/${evo.instanceName}`,
      { headers: evoHeaders(evo.apiKey), timeout: 10000 }
    );
    return (r.data?.instance?.state || r.data?.state) === "open";
  } catch {
    return false;
  }
}

// === Gerenciamento de instancia (multi-tenant) ===

async function getInstanceStatus(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);

    const instResp = await axios.get(
      `${evo.apiUrl}/instance/fetchInstances`,
      { headers: evoHeaders(evo.apiKey) }
    );

    const instance = instResp.data.find(i => i.name === evo.instanceName);
    if (!instance) {
      return res.json({ exists: false, instance_name: evo.instanceName });
    }

    let state = instance.connectionStatus || "unknown";
    try {
      const stateResp = await axios.get(
        `${evo.apiUrl}/instance/connectionState/${evo.instanceName}`,
        { headers: evoHeaders(evo.apiKey) }
      );
      state = stateResp.data?.instance?.state || state;
    } catch (e) { /* usa status do fetchInstances */ }

    res.json({
      exists: true,
      instance_name: instance.name,
      state,
      owner_jid: instance.ownerJid,
      profile_name: instance.profileName,
      profile_pic: instance.profilePicUrl,
      number: instance.number,
      messages_count: instance._count?.Message || 0,
      contacts_count: instance._count?.Contact || 0,
      chats_count: instance._count?.Chat || 0,
    });
  } catch (err) {
    console.error("Erro ao buscar status da instancia:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao conectar com Evolution API." });
  }
}

async function createInstance(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);

    const instResp = await axios.get(
      `${evo.apiUrl}/instance/fetchInstances`,
      { headers: evoHeaders(evo.apiKey) }
    );
    const exists = instResp.data.find(i => i.name === evo.instanceName);
    if (exists) {
      return res.json({ success: true, message: "Instancia ja existe.", instance_name: evo.instanceName });
    }

    const resp = await axios.post(
      `${evo.apiUrl}/instance/create`,
      { instanceName: evo.instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true },
      { headers: evoHeaders(evo.apiKey) }
    );

    // Salvar config da empresa se ainda nao existir
    const [[existing]] = await db.query(
      "SELECT id FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'",
      [req.empresa_id]
    );
    if (!existing) {
      await db.query(
        "INSERT INTO empresa_configs (empresa_id, config_type, config_json) VALUES (?, 'whatsapp', ?)",
        [req.empresa_id, JSON.stringify({ api_url: evo.apiUrl, api_key: evo.apiKey, instance_name: evo.instanceName })]
      );
    }

    // Recebimento de mensagens (atendimento): falha aqui nao impede criar a instancia
    try { await require("../services/whatsappAtendimento").ativarWebhook(req.empresa_id); }
    catch (e) { console.warn("[whatsapp] webhook nao ativado:", e?.response?.data || e.message); }

    res.json({ success: true, data: resp.data });
  } catch (err) {
    console.error("Erro ao criar instancia:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao criar instancia." });
  }
}

async function getQrCode(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);
    const resp = await axios.get(
      `${evo.apiUrl}/instance/connect/${evo.instanceName}`,
      { headers: evoHeaders(evo.apiKey) }
    );
    res.json(resp.data);
  } catch (err) {
    console.error("Erro ao obter QR code:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao obter QR code." });
  }
}

async function deleteInstance(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);
    await axios.delete(
      `${evo.apiUrl}/instance/delete/${evo.instanceName}`,
      { headers: evoHeaders(evo.apiKey) }
    );
    // Remover config do banco
    await db.query(
      "DELETE FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'",
      [req.empresa_id]
    );
    res.json({ success: true, message: "Instancia removida." });
  } catch (err) {
    console.error("Erro ao deletar instancia:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao remover instancia." });
  }
}

async function restartInstance(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);
    await axios.post(
      `${evo.apiUrl}/instance/restart/${evo.instanceName}`,
      {},
      { headers: evoHeaders(evo.apiKey) }
    );
    res.json({ success: true, message: "Instancia reiniciada." });
  } catch (err) {
    console.error("Erro ao reiniciar instancia:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao reiniciar instancia." });
  }
}

async function logoutInstance(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);
    await axios.delete(
      `${evo.apiUrl}/instance/logout/${evo.instanceName}`,
      { headers: evoHeaders(evo.apiKey) }
    );
    res.json({ success: true, message: "WhatsApp desconectado." });
  } catch (err) {
    console.error("Erro ao desconectar:", err?.response?.data || err.message);
    res.status(500).json({ error: "Erro ao desconectar WhatsApp." });
  }
}

// Salvar/atualizar config WhatsApp da empresa
async function saveConfig(req, res) {
  try {
    const { api_url, api_key, instance_name } = req.body;
    const [[existing]] = await db.query(
      "SELECT id, config_json FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'",
      [req.empresa_id]
    );
    const atual = existing
      ? (typeof existing.config_json === "string" ? JSON.parse(existing.config_json) : existing.config_json) || {}
      : {};

    // URL/chave da Evolution e instancia de outra empresa: so a plataforma (super_admin) define.
    // Para as empresas a instancia e sempre `empresa_<id>` no servidor global; a chave global
    // do .env NUNCA e gravada na config da empresa nem devolvida ao navegador.
    const plataforma = req.user?.role === "super_admin";
    const nome = typeof instance_name === "string" ? instance_name.trim() : "";
    const configJson = JSON.stringify({
      api_url: plataforma && typeof api_url === "string" && api_url.trim() ? api_url.trim() : (atual.api_url || DEFAULT_API_URL),
      api_key: plataforma && typeof api_key === "string" && api_key.trim() && !api_key.endsWith("...") ? api_key.trim() : (atual.api_key && atual.api_key !== DEFAULT_API_KEY ? atual.api_key : ""),
      instance_name: plataforma && nome ? nome : `empresa_${req.empresa_id}`,
      // token do webhook de atendimento: gerado por whatsappAtendimento, nunca vem do formulario
      ...(atual.webhook_token ? { webhook_token: atual.webhook_token } : {}),
    });

    if (existing) {
      await db.query(
        "UPDATE empresa_configs SET config_json = ? WHERE empresa_id = ? AND config_type = 'whatsapp'",
        [configJson, req.empresa_id]
      );
    } else {
      await db.query(
        "INSERT INTO empresa_configs (empresa_id, config_type, config_json) VALUES (?, 'whatsapp', ?)",
        [req.empresa_id, configJson]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao salvar config WhatsApp:", err.message);
    res.status(500).json({ error: "Erro ao salvar configuracao." });
  }
}

async function getConfig(req, res) {
  try {
    const evo = await getEvolutionConfig(req.empresa_id);
    res.json({
      api_url: evo.apiUrl,
      // Nunca devolve a chave: a global do servidor e as particulares saem mascaradas.
      api_key: evo.apiKey && evo.apiKey !== DEFAULT_API_KEY ? mascarar(evo.apiKey) : "",
      instance_name: evo.instanceName,
    });
  } catch (err) {
    console.error("Erro ao buscar config WhatsApp:", err.message);
    res.status(500).json({ error: "Erro ao buscar configuracao." });
  }
}

// === Recebimento de mensagens (webhook da Evolution) ===

async function ativarWebhookInstancia(req, res) {
  try {
    res.json({ success: true, ...(await require("../services/whatsappAtendimento").ativarWebhook(req.empresa_id)) });
  } catch (err) {
    console.error("Erro ao ativar webhook WhatsApp:", err?.response?.data || err.message);
    res.status(502).json({ error: "Não foi possível ativar o recebimento. Confira se a instância existe e está conectada." });
  }
}

async function statusWebhookInstancia(req, res) {
  try {
    res.json(await require("../services/whatsappAtendimento").statusWebhook(req.empresa_id));
  } catch (err) {
    res.json({ ativo: false });
  }
}

// === Logs de envio ===

async function listarLogs(req, res) {
  try {
    const empresaId = req.empresa_id;
    const { status, telefone, data_inicio, data_fim, portal_id, page = 1, per_page = 20 } = req.query;

    const where = ["l.empresa_id = ?"];
    const params = [empresaId];

    if (status && ["ok", "erro", "skipped"].includes(status)) {
      where.push("l.status = ?");
      params.push(status);
    }
    if (telefone) {
      where.push("l.telefone LIKE ?");
      params.push(`%${String(telefone).replace(/\D/g, "")}%`);
    }
    if (portal_id) {
      where.push("l.portal_id = ?");
      params.push(parseInt(portal_id, 10));
    }
    if (data_inicio) {
      where.push("l.criado_em >= ?");
      params.push(data_inicio);
    }
    if (data_fim) {
      where.push("l.criado_em <= ?");
      params.push(data_fim);
    }

    const whereClause = where.join(" AND ");
    const limit = Math.max(1, Math.min(100, parseInt(per_page, 10) || 20));
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total
         FROM whatsapp_logs l
         LEFT JOIN portais p ON p.id = l.portal_id
        WHERE ${whereClause}`,
      params
    );

    const [rows] = await db.query(
      `SELECT l.*, p.nome as portal_nome
         FROM whatsapp_logs l
         LEFT JOIN portais p ON p.id = l.portal_id
        WHERE ${whereClause}
        ORDER BY l.criado_em DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({
      total,
      page: parseInt(page, 10) || 1,
      per_page: limit,
      logs: rows,
    });
  } catch (err) {
    console.error("Erro ao listar logs WhatsApp:", err.message);
    res.status(500).json({ error: "Erro ao listar logs" });
  }
}

async function limparLogs(req, res) {
  try {
    const empresaId = req.empresa_id;
    const { antes_de } = req.query;

    let sql = "DELETE FROM whatsapp_logs WHERE empresa_id = ?";
    const params = [empresaId];
    if (antes_de) {
      sql += " AND criado_em < ?";
      params.push(antes_de);
    }

    const [result] = await db.query(sql, params);
    res.json({ ok: true, removidos: result.affectedRows });
  } catch (err) {
    console.error("Erro ao limpar logs WhatsApp:", err.message);
    res.status(500).json({ error: "Erro ao limpar logs" });
  }
}

module.exports = {
  enviarMensagem,
  enviarMensagemDireta,
  enviarMensagemEstrita,
  instanciaConectada,
  getInstanceStatus,
  createInstance,
  getQrCode,
  deleteInstance,
  restartInstance,
  logoutInstance,
  saveConfig,
  getConfig,
  getEvolutionConfig,
  formatarNumeroComNonoDigito,
  ativarWebhookInstancia,
  statusWebhookInstancia,
  listarLogs,
  limparLogs,
};
