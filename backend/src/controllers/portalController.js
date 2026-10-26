const { urlHttpSegura } = require('../utils/entradaSegura');
const db = require("../../db");
const { motivoCampanhaInutilizavel } = require("../utils/campanhaAtiva");
const { DEFAULT_WHATSAPP_TEMPLATE } = require("../constants/whatsappDefaults");
const { normalizarCampos } = require("../utils/camposPortal");

exports.listarPortais = async (req, res) => {
  try {
    const [portais] = await db.query(`
      SELECT p.*,
        pt.nome as template_nome,
        (SELECT COUNT(*) FROM mikrotiks WHERE portal_id = p.id) as mikrotiks_vinculados
      FROM portais p
      LEFT JOIN portal_templates pt ON pt.id = p.template_id
      WHERE p.empresa_id = ?
      ORDER BY p.tipo, p.nome
    `, [req.empresa_id]);
    res.json(portais);
  } catch (err) {
    console.error("Erro ao listar portais:", err);
    res.status(500).json({ message: "Erro ao listar portais" });
  }
};

exports.criarPortal = async (req, res) => {
  const {
    nome, slug, descricao, html_content, url_redirect,
    template_id, custom_css, logo_url, cor_primaria, cor_fundo,
    campos_cadastro, mostrar_planos, mostrar_lgpd
  } = req.body;
  if (!nome || !slug) return res.status(400).json({ message: "Nome e slug são obrigatórios" });
  if (url_redirect && !urlHttpSegura(String(url_redirect))) {
    return res.status(400).json({ message: "URL de redirecionamento inválida (use http:// ou https://)" });
  }

  try {
    const [existing] = await db.query("SELECT id FROM portais WHERE slug = ? AND empresa_id = ?", [slug, req.empresa_id]);
    if (existing.length > 0) return res.status(400).json({ message: "Já existe um portal com esse slug" });

    // If template_id provided but no html_content, load from template
    let finalHtml = html_content || null;
    if (template_id && !html_content) {
      const [[tmpl]] = await db.query("SELECT html_template FROM portal_templates WHERE id = ?", [template_id]);
      if (tmpl) finalHtml = tmpl.html_template;
    }

    await db.execute(
      `INSERT INTO portais (empresa_id, nome, slug, tipo, url_redirect, html_content, descricao,
        template_id, custom_css, logo_url, cor_primaria, cor_fundo, campos_cadastro, mostrar_planos, mostrar_lgpd,
        whatsapp_template)
       VALUES (?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.empresa_id, nome, slug,
        url_redirect || null,
        finalHtml,
        descricao || null,
        template_id || null,
        custom_css || null,
        logo_url || null,
        cor_primaria || '#3B82F6',
        cor_fundo || '#0f111a',
        campos_cadastro ? JSON.stringify(campos_cadastro) : null,
        mostrar_planos ? 1 : 0,
        mostrar_lgpd !== undefined ? (mostrar_lgpd ? 1 : 0) : 1,
        DEFAULT_WHATSAPP_TEMPLATE
      ]
    );
    res.status(201).json({ message: "Portal criado com sucesso" });
  } catch (err) {
    console.error("Erro ao criar portal:", err);
    res.status(500).json({ message: "Erro ao criar portal" });
  }
};

exports.atualizarPortal = async (req, res) => {
  const { id } = req.params;
  const {
    nome, descricao, html_content, url_redirect,
    template_id, custom_css, logo_url, cor_primaria, cor_fundo,
    campos_cadastro, mostrar_planos, mostrar_lgpd, configuracoes,
    whatsapp_enabled, whatsapp_template,
  } = req.body;
  if (url_redirect && !urlHttpSegura(String(url_redirect))) {
    return res.status(400).json({ message: "URL de redirecionamento inválida (use http:// ou https://)" });
  }

  try {
    const [[portal]] = await db.query("SELECT * FROM portais WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    // If template_id provided but no html_content, load from template
    let finalHtml = html_content ?? portal.html_content;
    if (template_id && !html_content) {
      const [[tmpl]] = await db.query("SELECT html_template FROM portal_templates WHERE id = ?", [template_id]);
      if (tmpl) finalHtml = tmpl.html_template;
    }

    // Campos do formulario (visivel/obrigatorio): higieniza o que o admin enviou.
    // Aceita configuracoes como objeto ou como string JSON (o resto segue igual).
    let configuracoesFinal = configuracoes;
    if (typeof configuracoesFinal === 'string') {
      try { configuracoesFinal = JSON.parse(configuracoesFinal); } catch (e) { /* mantem a string original */ }
    }
    if (configuracoesFinal && typeof configuracoesFinal === 'object' && configuracoesFinal.campos !== undefined) {
      configuracoesFinal = { ...configuracoesFinal, campos: normalizarCampos(configuracoesFinal.campos) };
    }
    // link_portal_url vai para window.location.href no portal publico: so http(s) ou caminho relativo.
    if (configuracoesFinal && typeof configuracoesFinal === 'object' && configuracoesFinal.link_portal_url) {
      const l = String(configuracoesFinal.link_portal_url).trim();
      if (!(/^\/(?![\/\\])/.test(l) || urlHttpSegura(l))) {
        return res.status(400).json({ error: 'Link do portal inválido (use http://, https:// ou um caminho do site)' });
      }
    }
    const configJson = configuracoesFinal
      ? (typeof configuracoesFinal === 'string' ? configuracoesFinal : JSON.stringify(configuracoesFinal))
      : portal.configuracoes;

    await db.execute(
      `UPDATE portais SET
        nome = ?, descricao = ?, html_content = ?, url_redirect = ?,
        template_id = ?, custom_css = ?, logo_url = ?, cor_primaria = ?, cor_fundo = ?,
        campos_cadastro = ?, mostrar_planos = ?, mostrar_lgpd = ?, configuracoes = ?,
        whatsapp_enabled = ?, whatsapp_template = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        nome || portal.nome,
        descricao ?? portal.descricao,
        finalHtml,
        url_redirect ?? portal.url_redirect,
        template_id !== undefined ? (template_id || null) : portal.template_id,
        custom_css !== undefined ? custom_css : portal.custom_css,
        logo_url !== undefined ? logo_url : portal.logo_url,
        cor_primaria || portal.cor_primaria || '#3B82F6',
        cor_fundo || portal.cor_fundo || '#0f111a',
        campos_cadastro ? JSON.stringify(campos_cadastro) : (portal.campos_cadastro || null),
        mostrar_planos !== undefined ? (mostrar_planos ? 1 : 0) : portal.mostrar_planos,
        mostrar_lgpd !== undefined ? (mostrar_lgpd ? 1 : 0) : portal.mostrar_lgpd,
        configJson,
        whatsapp_enabled !== undefined ? (whatsapp_enabled ? 1 : 0) : portal.whatsapp_enabled,
        whatsapp_template !== undefined ? whatsapp_template : portal.whatsapp_template,
        id,
        req.empresa_id
      ]
    );
    res.json({ message: "Portal atualizado" });
  } catch (err) {
    console.error("Erro ao atualizar portal:", err);
    res.status(500).json({ message: "Erro ao atualizar portal" });
  }
};

// Variaveis fake para preview/teste de template de WhatsApp
const FAKE_VARS = {
  nome: "Joao da Silva",
  username: "12345678900",
  password: "12345678900",
  plano: "Plano 1 Hora",
  duracao: 60,
  velocidade: "10M/50M",
  valor: "R$ 5,00",
  empresa: "Hotspot Demo",
  login_url: "http://hotspot.local/login?username=12345678900&password=12345678900",
  expira_em: "01/01/2026 10:00",
  cpf: "123.456.789-00",
};

function renderFakeTemplate(template) {
  if (!template) return "";
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = FAKE_VARS[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

// POST /api/portais/:id/whatsapp-preview - retorna o template renderizado com variaveis fake
exports.whatsappPreview = async (req, res) => {
  const { id } = req.params;
  try {
    const [[portal]] = await db.query(
      "SELECT whatsapp_template FROM portais WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    const template = req.body?.template ?? portal.whatsapp_template ?? "";
    const preview = renderFakeTemplate(template);
    res.json({ preview, vars: FAKE_VARS });
  } catch (err) {
    console.error("Erro no preview WhatsApp:", err);
    res.status(500).json({ message: "Erro ao gerar preview" });
  }
};

// POST /api/portais/:id/whatsapp-teste - envia mensagem de teste real para um numero
exports.whatsappTeste = async (req, res) => {
  const { id } = req.params;
  const { telefone, template } = req.body || {};
  if (!telefone) return res.status(400).json({ message: "Telefone obrigatorio" });

  try {
    const [[portal]] = await db.query(
      "SELECT whatsapp_template FROM portais WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    const tpl = template ?? portal.whatsapp_template ?? "";
    const mensagem = renderFakeTemplate(tpl);
    if (!mensagem.trim()) {
      return res.status(400).json({ message: "Template vazio" });
    }

    // Normalizacao por comprimento (ver whatsappNotify.normalizarTelefone).
    // NAO usar startsWith("55") — DDD 55 (RS) confunde com DDI.
    const telDigits = String(telefone).replace(/\D/g, "");
    let telComDDI;
    if (telDigits.length === 10 || telDigits.length === 11) telComDDI = `55${telDigits}`;
    else if (telDigits.length === 12 || telDigits.length === 13) telComDDI = telDigits;
    else return res.status(400).json({ message: "Telefone invalido (tamanho inesperado)" });

    const { enviarMensagemDireta } = require("./whatsappController");
    try {
      await enviarMensagemDireta(telComDDI, mensagem, req.empresa_id);
      await db.query(
        `INSERT INTO whatsapp_logs (empresa_id, portal_id, telefone, mensagem, contexto_tipo, status)
         VALUES (?, ?, ?, ?, 'teste', 'ok')`,
        [req.empresa_id, id, telComDDI, mensagem]
      );
      res.json({ ok: true, message: "Mensagem enviada", mensagem });
    } catch (sendErr) {
      const erroMsg = sendErr?.response?.data?.message || sendErr?.message || "erro";
      await db.query(
        `INSERT INTO whatsapp_logs (empresa_id, portal_id, telefone, mensagem, contexto_tipo, status, erro_msg)
         VALUES (?, ?, ?, ?, 'teste', 'erro', ?)`,
        [req.empresa_id, id, telComDDI, mensagem, String(erroMsg).slice(0, 500)]
      );
      res.status(500).json({ ok: false, message: erroMsg });
    }
  } catch (err) {
    console.error("Erro no teste WhatsApp:", err);
    res.status(500).json({ message: "Erro ao enviar teste" });
  }
};

exports.deletarPortal = async (req, res) => {
  const { id } = req.params;
  try {
    const [[portal]] = await db.query("SELECT tipo FROM portais WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });
    if (portal.tipo !== "custom") return res.status(400).json({ message: "Não é possível remover portais built-in" });

    await db.execute("UPDATE mikrotiks SET portal_id = NULL WHERE portal_id = ? AND empresa_id = ?", [id, req.empresa_id]);
    await db.execute("DELETE FROM portais WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    res.json({ message: "Portal removido" });
  } catch (err) {
    console.error("Erro ao deletar portal:", err);
    res.status(500).json({ message: "Erro ao deletar portal" });
  }
};

exports.previewPortal = async (req, res) => {
  const { id } = req.params;
  try {
    const [[portal]] = await db.query("SELECT * FROM portais WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    if (portal.tipo === "custom" && portal.html_content) {
      let html = portal.html_content
        .replace(/\$\(mac\)/g, "AA:BB:CC:DD:EE:FF")
        .replace(/\$\(ip\)/g, "192.168.1.100")
        .replace(/\$\(mikrotik_id\)/g, "1");

      // Inject custom CSS if present
      if (portal.custom_css) {
        html = html.replace('</head>', `<style>${portal.custom_css}</style></head>`);
      }

      res.setHeader("Content-Type", "text/html");
      // CSP basica: o preview roda no dominio do painel, entao restringimos
      // enquadramento e definimos policy baseline pro HTML controlado pelo tenant.
      // sandbox sem allow-same-origin: o HTML do tenant roda em origem opaca e nao alcanca o
      // localStorage (admin_token) do painel, mesmo que um super admin abra o preview.
      res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms; default-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(html);
    }

    if (portal.url_redirect) {
      return res.redirect(portal.url_redirect + "?mac=AA:BB:CC:DD:EE:FF&ip=192.168.1.100&preview=1&empresa_id=" + req.empresa_id);
    }

    res.status(400).json({ message: "Portal sem conteúdo para preview" });
  } catch (err) {
    console.error("Erro no preview:", err);
    res.status(500).json({ message: "Erro ao gerar preview" });
  }
};

exports.uploadLogo = async (req, res) => {
  const { id } = req.params;
  try {
    if (!req.file) return res.status(400).json({ message: "Nenhuma imagem enviada" });

    const logoUrl = `/uploads/logos/${req.file.filename}`;

    // Update the logo_url inside the portal's 'configuracoes' JSON
    const [[portal]] = await db.query("SELECT configuracoes FROM portais WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    let config = {};
    try { config = JSON.parse(portal.configuracoes || '{}'); } catch (e) {}
    config.logo_url = logoUrl;

    await db.query(
      "UPDATE portais SET configuracoes = ?, logo_url = ? WHERE id = ? AND empresa_id = ?",
      [JSON.stringify(config), logoUrl, id, req.empresa_id]
    );

    res.json({ message: "Logo enviada com sucesso", logo_url: logoUrl });
  } catch (err) {
    console.error("Erro no upload de logo:", err);
    res.status(500).json({ message: "Erro ao fazer upload da logo" });
  }
};

exports.vincularCampanha = async (req, res) => {
  const portalId = parseInt(req.params.portalId, 10);
  const { campanha_ativa_id } = req.body;

  try {
    const [[portal]] = await db.query(
      "SELECT id FROM portais WHERE id = ? AND empresa_id = ?",
      [portalId, req.empresa_id]
    );
    if (!portal) return res.status(404).json({ message: "Portal não encontrado" });

    if (campanha_ativa_id) {
      // So vincula campanha que o portal consegue mostrar (ativa e com itens): senao o cliente seria
      // redirecionado ao pre-portal e voltaria sem ver nada.
      const motivo = await motivoCampanhaInutilizavel(campanha_ativa_id, req.empresa_id);
      if (motivo === "nao_encontrada") return res.status(400).json({ message: "Campanha não encontrada" });
      if (motivo === "inativa") return res.status(400).json({ message: "Campanha inativa. Ative a campanha antes de vincular ao portal." });
      if (motivo === "sem_itens") return res.status(400).json({ message: "Campanha sem itens. Adicione ao menos uma imagem ou vídeo antes de vincular." });
    }

    await db.execute(
      "UPDATE portais SET campanha_ativa_id = ? WHERE id = ? AND empresa_id = ?",
      [campanha_ativa_id || null, portalId, req.empresa_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao vincular campanha ao portal:", err);
    res.status(500).json({ message: "Erro ao vincular campanha ao portal" });
  }
};

// Endpoint público: retorna config visual de um portal para a página pública renderizar
exports.getPortalConfig = async (req, res) => {
  const { tipo } = req.params;
  const empresa_id = req.query.empresa_id;
  if (!empresa_id) return res.status(400).json({ message: "empresa_id obrigatório" });

  try {
    const [[portal]] = await db.query(
      "SELECT configuracoes, cor_primaria, cor_fundo, logo_url, custom_css FROM portais WHERE tipo = ? AND empresa_id = ?",
      [tipo, empresa_id]
    );
    if (!portal) return res.json({});

    let config = {};
    if (portal.configuracoes) {
      try { config = JSON.parse(portal.configuracoes); } catch (e) {}
    }
    config.cor_primaria = portal.cor_primaria;
    config.cor_fundo = portal.cor_fundo;
    config.logo_url = portal.logo_url;
    config.custom_css = portal.custom_css;

    res.json(config);
  } catch (err) {
    console.error("Erro ao buscar config do portal:", err);
    res.status(500).json({});
  }
};
