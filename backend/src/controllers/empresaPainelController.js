// Painel por empresa do Super Admin (so dono da plataforma): resumo, plano, gratificacao, plano gratis,
// suspensao, notas e historico. Toda escrita grava uma linha em empresa_historico.
const db = require("../../db");
const { aplicarAssinatura } = require("./assinaturaController");
const { tabelaInexistente } = require("../utils/assinatura");
const { limparCacheSessaoAdmin } = require("../utils/sessaoAdmin");
const { montarAlertas } = require("../utils/alertasPlataforma");
const boasVindas = require("../services/boasVindasEmpresa");
const { validarTextoManual } = require("../utils/boasVindas");
const { clienteDesde, validarMotivo, validarDias, validarNota, idValido, detalhe } = require("../utils/empresaPainel");

const linhas = async (sql, params = []) => (await db.query(sql, params))[0];
const primeira = async (sql, params = []) => (await linhas(sql, params))[0] || null;

async function bloco(nome, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!tabelaInexistente(err)) console.error(`[empresa-painel] ${nome}:`, err.message);
    return null;
  }
}

// Historico e' trilha de auditoria: falha em gravar nao desfaz a acao ja feita (so vai para o log).
async function registrar(empresaId, adminId, acao, texto) {
  try {
    await db.query("INSERT INTO empresa_historico (empresa_id, admin_id, acao, detalhes) VALUES (?, ?, ?, ?)", [empresaId, adminId || null, acao, texto || null]);
  } catch (err) {
    if (!tabelaInexistente(err)) console.error("[empresa-painel] historico:", err.message);
  }
}

// Carrega a empresa do :id ou responde 400/404 (devolve null quando ja respondeu).
async function empresaDoParametro(req, res) {
  const id = idValido(req.params.id);
  if (!id) { res.status(400).json({ message: "Empresa inválida" }); return null; }
  const emp = await primeira("SELECT * FROM empresas WHERE id = ?", [id]);
  if (!emp) { res.status(404).json({ message: "Empresa não encontrada" }); return null; }
  return emp;
}

async function planoPorId(id) {
  return primeira("SELECT * FROM saas_planos WHERE id = ?", [id]);
}

const resposta = (res, err) => {
  if (err && err.status) return res.status(err.status).json({ message: err.message });
  console.error("[empresa-painel]", err && err.message);
  return res.status(500).json({ message: "Erro ao salvar." });
};

// Alertas so desta empresa (mesmas regras do painel geral, sem varrer as outras).
async function alertasDaEmpresa(emp, totalEquipamentos) {
  const offline = new Map();
  const eq = await primeira(
    `SELECT SUM(online = 0) AS offline, COUNT(*) AS total, MAX(verificado_em) AS verificado_em FROM equipamento_status WHERE empresa_id = ?`, [emp.id]);
  if (eq && Number(eq.total) > 0) offline.set(emp.id, { offline: Number(eq.offline) || 0, total: Number(eq.total), verificado_em: eq.verificado_em });
  const ultimaConexao = new Map();
  const cx = await primeira(
    `SELECT MAX(ra.acctstarttime) AS ultima FROM mikrotiks m
       JOIN radacct ra ON ra.nasipaddress COLLATE utf8mb4_unicode_ci = m.ip COLLATE utf8mb4_unicode_ci WHERE m.empresa_id = ?`, [emp.id]);
  if (cx && cx.ultima) ultimaConexao.set(emp.id, cx.ultima);
  const whatsapp = new Map();
  const cfg = await primeira("SELECT 1 AS ok FROM empresa_configs WHERE empresa_id = ? AND config_type = 'whatsapp'", [emp.id]);
  if (cfg) whatsapp.set(emp.id, await require("./whatsappController").instanciaConectada(emp.id));
  const r = montarAlertas({ empresas: [{ id: emp.id, ativo: emp.ativo, criado_em: emp.criado_em, total_mikrotiks: totalEquipamentos }], offline, ultimaConexao, whatsapp, dias: 3 });
  return r.length ? r[0].alertas : [];
}

exports.resumo = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const id = emp.id;
    const agora = new Date();

    const [assinatura, adicionais, cobrancas, uso, planosGratis] = await Promise.all([
      bloco("assinatura", async () => {
        const a = await primeira("SELECT * FROM assinaturas WHERE empresa_id = ?", [id]);
        if (!a) return null;
        const p = a.plano_id ? await planoPorId(a.plano_id) : null;
        return {
          status: a.status, trial_ate: a.trial_ate, vence_em: a.vence_em,
          plano_id: a.plano_id, plano_nome: p ? p.nome : null,
          plano_valor: p ? Number(p.valor) : null, ciclo_dias: p ? p.ciclo_dias : null, gratis: !!(p && p.gratis),
        };
      }),
      bloco("adicionais", () => linhas(
        `SELECT aa.id, aa.quantidade, aa.vence_em, ad.nome, ad.tipo FROM assinatura_adicionais aa
           JOIN saas_adicionais ad ON ad.id = aa.adicional_id WHERE aa.empresa_id = ? ORDER BY aa.vence_em DESC LIMIT 20`, [id])),
      bloco("cobrancas", () => linhas(
        `SELECT c.id, c.valor, c.metodo, c.status, c.pago_em, c.criado_em, sp.nome AS plano_nome
           FROM assinatura_cobrancas c LEFT JOIN saas_planos sp ON sp.id = c.plano_id
          WHERE c.empresa_id = ? ORDER BY c.id DESC LIMIT 20`, [id])),
      bloco("uso", async () => {
        const eq = await primeira("SELECT COUNT(*) AS n FROM mikrotiks WHERE empresa_id = ?", [id]);
        const ad = await primeira("SELECT COUNT(*) AS n FROM admin_empresas WHERE empresa_id = ?", [id]);
        const ld = await primeira(
          "SELECT COUNT(*) AS total, COALESCE(SUM(criado_em >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0) AS novos FROM leads WHERE empresa_id = ?", [id]);
        const cx = await primeira(
          `SELECT COUNT(*) AS n FROM radacct ra JOIN mikrotiks m ON ra.nasipaddress COLLATE utf8mb4_unicode_ci = m.ip COLLATE utf8mb4_unicode_ci
            WHERE m.empresa_id = ? AND ra.acctstarttime >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, [id]);
        const vd = await primeira(
          `SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS centavos FROM pagamentos
            WHERE empresa_id = ? AND status = 'approved' AND criado_em >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, [id]);
        return {
          equipamentos: Number(eq.n) || 0, admins: Number(ad.n) || 0,
          clientes_total: Number(ld.total) || 0, clientes_novos_30d: Number(ld.novos) || 0,
          conexoes_30d: Number(cx.n) || 0,
          vendas_30d: { n: Number(vd.n) || 0, valor: (Number(vd.centavos) || 0) / 100 },
        };
      }),
      bloco("planos_gratis", () => linhas("SELECT id, nome FROM saas_planos WHERE gratis = 1 AND ativo = 1 ORDER BY ordem, id")),
    ]);
    const alertas = await bloco("alertas", () => alertasDaEmpresa(emp, uso ? uso.equipamentos : 0));
    const planos = await bloco("planos", () => linhas("SELECT id, nome, valor, ciclo_dias, gratis FROM saas_planos WHERE ativo = 1 ORDER BY ordem, id"));
    const cliente = clienteDesde(emp.criado_em, agora);

    res.json({
      empresa: {
        id, nome: emp.nome, slug: emp.slug, ativo: !!emp.ativo, criado_em: emp.criado_em,
        tipo_pessoa: emp.tipo_pessoa || (emp.cnpj ? "PJ" : null), cnpj: emp.cnpj || null, cpf: emp.cpf || null,
        email: emp.email || null, telefone: emp.telefone || null,
        boas_vindas_em: emp.boas_vindas_em || null,
      },
      cliente_ha: cliente.texto,
      dias_de_cliente: cliente.dias,
      assinatura, adicionais, cobrancas, uso, alertas,
      planos: planos || [],
      planos_gratis: planosGratis || [],
    });
  } catch (err) {
    resposta(res, err);
  }
};

// Troca de plano; o vencimento atual e' mantido ("manter no plano" = simplesmente nao chamar).
exports.alterarPlano = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const planoId = idValido(req.body && req.body.plano_id);
    const plano = planoId ? await planoPorId(planoId) : null;
    if (!plano || !plano.ativo) return res.status(400).json({ message: "Plano inválido ou inativo." });
    const m = validarMotivo(req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });

    const antes = await primeira("SELECT a.plano_id, p.nome FROM assinaturas a LEFT JOIN saas_planos p ON p.id = a.plano_id WHERE a.empresa_id = ?", [emp.id]);
    await aplicarAssinatura(emp.id, { plano_id: plano.id });
    await registrar(emp.id, req.user.id, "plano_alterado", detalhe(`${(antes && antes.nome) || "sem plano"} → ${plano.nome}`, m.motivo));
    res.json({ message: "Plano alterado." });
  } catch (err) {
    resposta(res, err);
  }
};

// Gratificacao: soma dias ao vencimento (ao fim do teste se ainda em trial).
exports.gratificar = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const d = validarDias(req.body && req.body.dias);
    if (d.erro) return res.status(400).json({ message: d.erro });
    const m = validarMotivo(req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });

    const a = await primeira("SELECT a.status, p.gratis FROM assinaturas a LEFT JOIN saas_planos p ON p.id = a.plano_id WHERE a.empresa_id = ?", [emp.id]);
    if (a && a.gratis) return res.status(409).json({ message: "A empresa está em plano gratuito, que nunca vence." });
    await aplicarAssinatura(emp.id, { estender_dias: d.dias, ...(a && a.status === "trial" ? { status: "trial" } : {}) });
    await registrar(emp.id, req.user.id, "gratificacao", detalhe(`+${d.dias} dias`, m.motivo));
    res.json({ message: `Gratificação de ${d.dias} dia(s) liberada.` });
  } catch (err) {
    resposta(res, err);
  }
};

// Plano gratis: so aceita plano marcado como gratuito (saas_planos.gratis = 1, migration 047).
exports.planoGratis = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const planoId = idValido(req.body && req.body.plano_id);
    const plano = planoId ? await planoPorId(planoId) : null;
    if (!plano || !plano.ativo || !plano.gratis) {
      return res.status(409).json({ message: "Escolha um plano gratuito ativo. Crie um em Planos SaaS, se ainda não houver." });
    }
    const m = validarMotivo(req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });
    await aplicarAssinatura(emp.id, { plano_id: plano.id, status: "ativa" });
    await registrar(emp.id, req.user.id, "plano_gratis", detalhe(plano.nome, m.motivo));
    res.json({ message: "Empresa colocada no plano gratuito." });
  } catch (err) {
    resposta(res, err);
  }
};

// Sai do gratis: plano pago, ativa por N dias (padrao 30).
exports.planoPago = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const planoId = idValido(req.body && req.body.plano_id);
    const plano = planoId ? await planoPorId(planoId) : null;
    if (!plano || !plano.ativo || plano.gratis) return res.status(400).json({ message: "Escolha um plano pago ativo." });
    const d = validarDias(req.body.dias == null || req.body.dias === "" ? 30 : req.body.dias);
    if (d.erro) return res.status(400).json({ message: d.erro });
    const m = validarMotivo(req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });
    const venceEm = new Date(Date.now() + d.dias * 24 * 60 * 60 * 1000);
    await aplicarAssinatura(emp.id, { plano_id: plano.id, status: "ativa", vence_em: venceEm });
    await registrar(emp.id, req.user.id, "plano_pago", detalhe(`${plano.nome} por ${d.dias} dias`, m.motivo));
    res.json({ message: "Empresa colocada em plano pago." });
  } catch (err) {
    resposta(res, err);
  }
};

exports.statusAssinatura = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const status = req.body && req.body.status;
    if (!["trial", "ativa", "vencida", "cancelada"].includes(status)) return res.status(400).json({ message: "Status inválido." });
    const m = validarMotivo(req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });
    await aplicarAssinatura(emp.id, { status });
    await registrar(emp.id, req.user.id, "status_assinatura", detalhe(status, m.motivo));
    res.json({ message: "Status da assinatura atualizado." });
  } catch (err) {
    resposta(res, err);
  }
};

async function mudarAtivo(req, res, ativo) {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const m = validarMotivo(req.body && req.body.motivo);
    if (m.erro) return res.status(400).json({ message: m.erro });
    if (!ativo) {
      const plataforma = parseInt(process.env.SITE_EMPRESA_ID, 10) || 1;
      if (emp.id === plataforma || emp.id === Number(req.user.empresa_id)) {
        return res.status(409).json({ message: "Esta empresa não pode ser suspensa (é a da plataforma ou a que você está usando)." });
      }
    }
    await db.query("UPDATE empresas SET ativo = ? WHERE id = ?", [ativo ? 1 : 0, emp.id]);
    limparCacheSessaoAdmin();
    await registrar(emp.id, req.user.id, ativo ? "reativada" : "suspensa", m.motivo);
    res.json({ message: ativo ? "Empresa reativada." : "Empresa suspensa. O painel dela deixa de abrir em até 1 minuto." });
  } catch (err) {
    resposta(res, err);
  }
}
exports.suspender = (req, res) => mudarAtivo(req, res, false);
exports.reativar = (req, res) => mudarAtivo(req, res, true);

const SEM_TABELA = { message: "Rode a migration 070 (node migrations/070_empresa_painel.js)." };

exports.listarNotas = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    res.json(await linhas(
      `SELECT n.id, n.texto, n.criado_em, a.nome AS autor FROM empresa_notas n LEFT JOIN admins a ON a.id = n.admin_id
        WHERE n.empresa_id = ? ORDER BY n.id DESC LIMIT 100`, [emp.id]));
  } catch (err) {
    if (tabelaInexistente(err)) return res.status(503).json(SEM_TABELA);
    resposta(res, err);
  }
};

exports.criarNota = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const n = validarNota(req.body && req.body.texto);
    if (n.erro) return res.status(400).json({ message: n.erro });
    await db.query("INSERT INTO empresa_notas (empresa_id, admin_id, texto) VALUES (?, ?, ?)", [emp.id, req.user.id, n.texto]);
    res.status(201).json({ message: "Nota salva." });
  } catch (err) {
    if (tabelaInexistente(err)) return res.status(503).json(SEM_TABELA);
    resposta(res, err);
  }
};

exports.removerNota = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const notaId = idValido(req.params.notaId);
    if (!notaId) return res.status(400).json({ message: "Nota inválida" });
    await db.query("DELETE FROM empresa_notas WHERE id = ? AND empresa_id = ?", [notaId, emp.id]);
    res.json({ message: "Nota removida." });
  } catch (err) {
    if (tabelaInexistente(err)) return res.status(503).json(SEM_TABELA);
    resposta(res, err);
  }
};

exports.historico = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    res.json(await linhas(
      `SELECT h.id, h.acao, h.detalhes, h.criado_em, a.nome AS autor FROM empresa_historico h LEFT JOIN admins a ON a.id = h.admin_id
        WHERE h.empresa_id = ? ORDER BY h.id DESC LIMIT 100`, [emp.id]));
  } catch (err) {
    if (tabelaInexistente(err)) return res.status(503).json(SEM_TABELA);
    resposta(res, err);
  }
};

// Mensagem avulsa pela instancia WhatsApp da plataforma (variaveis {{nome}} {{empresa}} {{plano}} {{vence_em}}).
exports.enviarWhatsapp = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const { erro, texto } = validarTextoManual(req.body && req.body.texto);
    if (erro) return res.status(400).json({ message: erro });
    const r = await boasVindas.enviarManual(emp.id, texto, req.user && req.user.id);
    res.json({ message: "Mensagem enviada pelo chat do WhatsApp.", conversa_id: r.conversa_id });
  } catch (err) {
    resposta(res, err);
  }
};

const MOTIVOS_BV = {
  telefone_invalido: [400, "Esta empresa não tem um telefone válido cadastrado."],
  whatsapp_desconectado: [409, "O WhatsApp da plataforma não está conectado."],
  sem_migration: [503, "Rode a migration 073 no servidor (node migrations/073_empresa_boas_vindas.js)."],
  empresa_da_plataforma: [400, "Esta é a empresa da plataforma."],
};

exports.reenviarBoasVindas = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const r = await boasVindas.enviarBoasVindas(emp.id, { forcar: true, adminId: req.user && req.user.id });
    if (r.ok) return res.json({ message: "Boas-vindas enviada." });
    const [status, message] = MOTIVOS_BV[r.motivo] || [502, "Não foi possível enviar agora."];
    res.status(status).json({ message });
  } catch (err) {
    resposta(res, err);
  }
};

// Abre/cria a conversa da empresa no chat (aba WhatsApp) da plataforma; o painel navega ate ela.
exports.abrirConversa = async (req, res) => {
  try {
    const emp = await empresaDoParametro(req, res);
    if (!emp) return;
    const c = await boasVindas.abrirConversaDaEmpresa(emp.id);
    if (!c.plataformaSlug) return res.status(500).json({ message: "Empresa da plataforma não encontrada (SITE_EMPRESA_ID)." });
    res.json({ conversa_id: c.id, plataforma_id: c.plataformaId, plataforma_slug: c.plataformaSlug });
  } catch (err) {
    resposta(res, err);
  }
};
