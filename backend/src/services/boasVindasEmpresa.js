// Mensagens automaticas da PLATAFORMA para as empresas-clientes (boas-vindas ao cadastrar e lembrete de
// ativacao), enviadas pela instancia WhatsApp da empresa da plataforma (SITE_EMPRESA_ID).
// Nunca lanca para quem chamou: devolve { ok, motivo }. Config em plataforma_configs (chave 'boas_vindas').
const db = require("../../db");
const { instanciaConectada, enviarMensagemEstrita } = require("../controllers/whatsappController");
const { gravarLog, normalizarTelefone, renderTemplate } = require("./whatsappNotify");
const { temColuna } = require("../utils/schemaCache");
const { mesclarConfig, montarVars, linkPainelDaEmpresa } = require("../utils/boasVindas");

const plataformaId = () => parseInt(process.env.SITE_EMPRESA_ID, 10) || 1;
const curto = (t, n = 80) => String(t || "").replace(/\s+/g, " ").slice(0, n);

async function obterConfig() {
  try {
    const [[row]] = await db.query("SELECT config_json FROM plataforma_configs WHERE chave = 'boas_vindas'");
    const cfg = row && (typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json);
    return mesclarConfig(cfg);
  } catch {
    return mesclarConfig(null);
  }
}

async function salvarConfig(config) {
  await db.query(
    "INSERT INTO plataforma_configs (chave, config_json) VALUES ('boas_vindas', ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)",
    [JSON.stringify(config)]
  );
}

// Trilha em empresa_historico (migration 070); falha em gravar nao desfaz o envio.
async function registrarHistorico(empresaId, adminId, acao, texto) {
  try {
    await db.query("INSERT INTO empresa_historico (empresa_id, admin_id, acao, detalhes) VALUES (?, ?, ?, ?)", [empresaId, adminId || null, acao, texto || null]);
  } catch (err) {
    if (err && err.code !== "ER_NO_SUCH_TABLE") console.error("[boas-vindas] historico:", err.message);
  }
}

async function carregarEmpresa(empresaId) {
  const [[emp]] = await db.query("SELECT id, nome, slug, telefone, criado_em FROM empresas WHERE id = ?", [empresaId]);
  if (!emp) return null;
  let plano = "", trialAte = null, venceEm = null;
  try {
    const [[a]] = await db.query(
      `SELECT p.nome AS plano, a.trial_ate, a.vence_em FROM assinaturas a LEFT JOIN saas_planos p ON p.id = a.plano_id WHERE a.empresa_id = ?`, [empresaId]);
    if (a) { plano = a.plano || ""; trialAte = a.trial_ate; venceEm = a.vence_em; }
  } catch { /* sem assinatura: so o nome */ }
  return { ...emp, plano, trialAte, venceEm };
}

const variaveis = (emp) => montarVars({ empresa: emp, plano: emp.plano, trialAte: emp.trialAte, venceEm: emp.venceEm, linkPainel: linkPainelDaEmpresa(emp.slug) });

// Envia e registra log; lanca se o envio falhar.
async function enviar(emp, tel, texto, contexto) {
  try {
    await enviarMensagemEstrita(tel, texto, plataformaId());
    await gravarLog({ empresa_id: plataformaId(), telefone: tel, mensagem: texto, contexto_tipo: contexto, referencia_id: emp.id, status: "ok" });
  } catch (err) {
    await gravarLog({ empresa_id: plataformaId(), telefone: tel, mensagem: texto, contexto_tipo: contexto, referencia_id: emp.id, status: "erro", erro_msg: err.message });
    throw err;
  }
}

// Boas-vindas. opts.forcar = reenvio manual (ignora "desligada" e "ja enviada").
async function enviarBoasVindas(empresaId, opts = {}) {
  try {
    if (Number(empresaId) === plataformaId()) return { ok: false, motivo: "empresa_da_plataforma" };
    if (!(await temColuna("empresas", "boas_vindas_em"))) return { ok: false, motivo: "sem_migration" };
    const cfg = await obterConfig();
    if (!opts.forcar && !cfg.ativo) return { ok: false, motivo: "desligada" };
    const emp = await carregarEmpresa(empresaId);
    if (!emp) return { ok: false, motivo: "empresa_inexistente" };
    const tel = normalizarTelefone(emp.telefone);
    if (!tel) return { ok: false, motivo: "telefone_invalido" };
    if (!(await instanciaConectada(plataformaId()))) return { ok: false, motivo: "whatsapp_desconectado" };

    // Reserva atomica: dois disparos (cadastro + job) nunca mandam duas vezes.
    let reservou = false;
    if (!opts.forcar) {
      const [r] = await db.query("UPDATE empresas SET boas_vindas_em = NOW() WHERE id = ? AND boas_vindas_em IS NULL", [empresaId]);
      if (!r.affectedRows) return { ok: false, motivo: "ja_enviada" };
      reservou = true;
    }
    try {
      await enviar(emp, tel, renderTemplate(cfg.mensagem, variaveis(emp)), "boas_vindas_empresa");
    } catch (err) {
      if (reservou) await db.query("UPDATE empresas SET boas_vindas_em = NULL WHERE id = ?", [empresaId]).catch(() => {});
      return { ok: false, motivo: "erro_envio", erro: err.message };
    }
    if (opts.forcar) await db.query("UPDATE empresas SET boas_vindas_em = NOW() WHERE id = ?", [empresaId]).catch(() => {});
    await registrarHistorico(empresaId, opts.adminId, "boas_vindas", opts.forcar ? "Reenviada manualmente" : "Enviada automaticamente");
    return { ok: true };
  } catch (err) {
    console.error("[boas-vindas] erro:", err.message);
    return { ok: false, motivo: "erro", erro: err.message };
  }
}

// Lembrete 48 h depois, so para empresa SEM equipamento. 1 vez (marcado em empresa_historico).
async function enviarLembreteAtivacao(empresaId) {
  try {
    const cfg = await obterConfig();
    if (!cfg.lembrete_ativacao.ativo) return { ok: false, motivo: "desligado" };
    const emp = await carregarEmpresa(empresaId);
    if (!emp) return { ok: false, motivo: "empresa_inexistente" };
    const tel = normalizarTelefone(emp.telefone);
    if (!tel) return { ok: false, motivo: "telefone_invalido" };
    const [[eq]] = await db.query("SELECT COUNT(*) AS n FROM mikrotiks WHERE empresa_id = ?", [empresaId]);
    if (Number(eq.n) > 0) return { ok: false, motivo: "ja_tem_equipamento" };
    if (!(await instanciaConectada(plataformaId()))) return { ok: false, motivo: "whatsapp_desconectado" };
    // Sem a tabela de historico nao ha como garantir "1 vez": melhor nao enviar.
    const [[ja]] = await db.query("SELECT COUNT(*) AS n FROM empresa_historico WHERE empresa_id = ? AND acao = 'lembrete_ativacao'", [empresaId]);
    if (Number(ja.n) > 0) return { ok: false, motivo: "ja_enviado" };
    await registrarHistorico(empresaId, null, "lembrete_ativacao", "Lembrete de ativação enviado");
    try {
      await enviar(emp, tel, renderTemplate(cfg.lembrete_ativacao.mensagem, variaveis(emp)), "lembrete_ativacao_empresa");
    } catch (err) {
      await db.query("DELETE FROM empresa_historico WHERE empresa_id = ? AND acao = 'lembrete_ativacao'", [empresaId]).catch(() => {});
      return { ok: false, motivo: "erro_envio", erro: err.message };
    }
    return { ok: true };
  } catch (err) {
    if (err && err.code !== "ER_NO_SUCH_TABLE") console.error("[boas-vindas] lembrete:", err.message);
    return { ok: false, motivo: "erro" };
  }
}

// Mensagem avulsa do dono da plataforma. Lanca { status, message } para a rota traduzir.
async function enviarManual(empresaId, texto, adminId) {
  const emp = await carregarEmpresa(empresaId);
  if (!emp) throw Object.assign(new Error("Empresa não encontrada"), { status: 404 });
  const tel = normalizarTelefone(emp.telefone);
  if (!tel) throw Object.assign(new Error("Esta empresa não tem um telefone válido cadastrado."), { status: 400 });
  if (!(await instanciaConectada(plataformaId()))) {
    throw Object.assign(new Error("O WhatsApp da plataforma não está conectado. Conecte em Integrações ou use o botão Abrir WhatsApp."), { status: 409 });
  }
  const final = renderTemplate(texto, variaveis(emp));
  try {
    await enviar(emp, tel, final, "plataforma_empresa");
  } catch {
    throw Object.assign(new Error("Não foi possível enviar a mensagem agora."), { status: 502 });
  }
  await registrarHistorico(empresaId, adminId, "whatsapp_enviado", curto(final));
  return { ok: true };
}

module.exports = { obterConfig, salvarConfig, enviarBoasVindas, enviarLembreteAtivacao, enviarManual, carregarEmpresa, variaveis, plataformaId };
