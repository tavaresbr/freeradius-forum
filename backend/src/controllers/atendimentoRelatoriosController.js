// Atendimento WhatsApp: relatorios de desempenho e sugestao de resposta por IA. Tudo escopado por empresa_id.
const db = require("../../db");
const auto = require("../services/whatsappAutomacao");
const ia = require("../services/sugestaoIA");
const { temColuna } = require("../utils/schemaCache");
const { verificarSaldoRadius } = require("../utils/leadUtils");
const { temRecurso, obterStatus } = require("../utils/assinatura");
const iaUso = require("../services/iaUso");

const erro500 = (res, err, msg) => { console.error("[atendimento]", err.message); res.status(500).json({ error: msg }); };
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;
const ymd = (d) => d.toISOString().slice(0, 10);

/** { de, ate } em AAAA-MM-DD (padrao: ultimos 30 dias; maximo 366). Lanca Error(.status=400). */
function lerPeriodo(q) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const hoje = new Date();
  const ate = q.ate === undefined || q.ate === "" ? ymd(hoje) : String(q.ate);
  const de = q.de === undefined || q.de === "" ? ymd(new Date(new Date(`${ate}T00:00:00Z`).getTime() - 29 * 86400000)) : String(q.de);
  if (!DIA.test(de) || !DIA.test(ate) || Number.isNaN(new Date(`${de}T00:00:00Z`).getTime()) || Number.isNaN(new Date(`${ate}T00:00:00Z`).getTime())) throw erro("Datas inválidas (use AAAA-MM-DD)");
  const dias = (new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000 + 1;
  if (dias < 1) throw erro("A data final deve ser depois da inicial");
  if (dias > MAX_DIAS) throw erro(`Período máximo de ${MAX_DIAS} dias`);
  return { de, ate };
}

const mediana = (v) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
};

// GET /api/atendimento/relatorios?de=&ate=
exports.relatorios = async (req, res) => {
  try {
    const { de, ate } = lerPeriodo(req.query);
    const emp = req.empresa_id;
    const ini = `${de} 00:00:00`;
    const fim = `${ate} 23:59:59`;
    const temAuto = await temColuna("whatsapp_mensagens", "automatica");
    const semAuto = temAuto ? "AND o.automatica = 0" : "";

    const [porDia] = await db.query(
      `SELECT DATE(criado_em) AS dia, SUM(direcao = 'in') AS recebidas, SUM(direcao = 'out') AS enviadas
         FROM whatsapp_mensagens WHERE empresa_id = ? AND direcao IN ('in','out') AND criado_em BETWEEN ? AND ?
        GROUP BY DATE(criado_em) ORDER BY dia`,
      [emp, ini, fim]
    );
    // Tempo da 1a resposta: 1a mensagem recebida do periodo -> 1a resposta (humana) depois dela
    const [tempos] = await db.query(
      `SELECT TIMESTAMPDIFF(SECOND, i.t, MIN(o.criado_em)) AS seg
         FROM (SELECT conversa_id, MIN(criado_em) AS t FROM whatsapp_mensagens
                WHERE empresa_id = ? AND direcao = 'in' AND criado_em BETWEEN ? AND ? GROUP BY conversa_id LIMIT 5000) i
         JOIN whatsapp_mensagens o ON o.conversa_id = i.conversa_id AND o.empresa_id = ? AND o.direcao = 'out' AND o.criado_em > i.t ${semAuto}
        GROUP BY i.conversa_id, i.t`,
      [emp, ini, fim, emp]
    );
    const segs = tempos.map((t) => Number(t.seg)).filter((n) => Number.isFinite(n) && n >= 0);
    const [porAtendente] = await db.query(
      `SELECT a.nome, COUNT(*) AS enviadas FROM whatsapp_mensagens m JOIN admins a ON a.id = m.admin_id
        WHERE m.empresa_id = ? AND m.direcao = 'out' AND m.criado_em BETWEEN ? AND ?
        GROUP BY m.admin_id, a.nome ORDER BY enviadas DESC LIMIT 50`,
      [emp, ini, fim]
    );
    const [status] = await db.query(
      "SELECT status, COUNT(*) AS n FROM whatsapp_conversas WHERE empresa_id = ? AND ultima_msg_em BETWEEN ? AND ? GROUP BY status",
      [emp, ini, fim]
    );
    const [[novas]] = await db.query("SELECT COUNT(*) AS n FROM whatsapp_conversas WHERE empresa_id = ? AND criado_em BETWEEN ? AND ?", [emp, ini, fim]);
    let satisfacao = { media: null, respostas: 0, distribuicao: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    if (await temColuna("whatsapp_conversas", "nota_satisfacao")) {
      const [notas] = await db.query(
        "SELECT nota_satisfacao AS nota, COUNT(*) AS n FROM whatsapp_conversas WHERE empresa_id = ? AND nota_satisfacao IS NOT NULL AND satisfacao_em BETWEEN ? AND ? GROUP BY nota_satisfacao",
        [emp, ini, fim]
      );
      let soma = 0, total = 0;
      for (const n of notas) { satisfacao.distribuicao[n.nota] = Number(n.n); soma += n.nota * Number(n.n); total += Number(n.n); }
      satisfacao = { ...satisfacao, respostas: total, media: total ? Math.round((soma / total) * 100) / 100 : null };
    }
    const conv = { abertas: 0, resolvidas: 0, novas: Number(novas.n) };
    for (const s of status) { if (s.status === "aberta") conv.abertas = Number(s.n); else if (s.status === "resolvida") conv.resolvidas = Number(s.n); }
    // Bloco IA (so se a migration 077 rodou): respostas da IA, conversas passadas ao humano e uso do mes
    let iaBloco = null;
    if (await temColuna("whatsapp_mensagens", "ia")) {
      try {
        const [[r]] = await db.query("SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND direcao = 'out' AND ia = 1 AND criado_em BETWEEN ? AND ?", [emp, ini, fim]);
        const [[t]] = await db.query("SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND direcao = 'nota' AND texto LIKE '🤖 IA passou para um atendente%' AND criado_em BETWEEN ? AND ?", [emp, ini, fim]);
        const uso = await iaUso.situacao(emp);
        iaBloco = { respostas: Number(r.n), transferidas: Number(t.n), mes: { usadas: uso.usadas, limite: uso.limite, restantes: uso.restantes } };
      } catch (e) { console.warn("[atendimento] relatorio IA:", e.message); }
    }
    res.json({
      periodo: { de, ate },
      ia: iaBloco,
      por_dia: porDia.map((d) => ({ dia: d.dia instanceof Date ? ymd(d.dia) : String(d.dia).slice(0, 10), recebidas: Number(d.recebidas), enviadas: Number(d.enviadas) })),
      primeira_resposta: { conversas: segs.length, media_seg: segs.length ? Math.round(segs.reduce((a, b) => a + b, 0) / segs.length) : null, mediana_seg: mediana(segs) },
      por_atendente: porAtendente.map((a) => ({ nome: a.nome, enviadas: Number(a.enviadas) })),
      conversas: conv,
      satisfacao,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    erro500(res, err, "Erro ao gerar o relatório");
  }
};

// GET /api/atendimento/ia-status  -> { disponivel (chave no servidor), ativo (empresa liberou) }
exports.iaStatus = async (req, res) => {
  try {
    const cfg = await auto.obterAutomacao(req.empresa_id);
    const recursoIa = ia.disponivel() && !!cfg.ia_sugestao && await temRecurso(req.empresa_id, "ia");
    const st = recursoIa ? await iaUso.situacao(req.empresa_id) : null;
    res.json({ disponivel: ia.disponivel(), ativo: ia.disponivel() && !!cfg.ia_sugestao, recurso_ia: !!recursoIa, restantes: st ? st.restantes : null });
  } catch (err) { erro500(res, err, "Erro ao consultar a IA"); }
};


/** Contexto mascarado da conversa para a IA (ultimas mensagens + nome, empresa, plano e saldo). */
async function montarContexto(empresaId, conversa) {
  const [recentes] = await db.query(
    "SELECT direcao, texto FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao IN ('in','out') AND texto IS NOT NULL ORDER BY id DESC LIMIT 20",
    [empresaId, conversa.id]
  );
  const [[emp]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]).catch(() => [[{}]]);
  let plano = null, restanteMin = null;
  if (conversa.lead_id) {
    try {
      const [[l]] = await db.query("SELECT cpf FROM leads WHERE id = ? AND empresa_id = ?", [conversa.lead_id, empresaId]);
      const cpf = String(l?.cpf || "").replace(/\D/g, "");
      if (cpf) {
        const [[ru]] = await db.query("SELECT p.nome FROM radius_users ru LEFT JOIN planos p ON p.id = ru.plano_id WHERE ru.empresa_id = ? AND ru.username = ? LIMIT 1", [empresaId, cpf]);
        plano = ru?.nome || null;
        const sd = await verificarSaldoRadius(cpf);
        if (sd.existe) restanteMin = Math.ceil((sd.tempoRestante || 0) / 60);
      }
    } catch { /* contexto extra e' opcional */ }
  }
  return { mensagens: recentes.reverse(), nome: conversa.nome, empresa: emp?.nome, plano, restanteMin };
}

/** Reserva 1 resposta do limite mensal do plano (true = pode usar). */
async function reservarCota(empresaId) {
  const st = await obterStatus(empresaId).catch(() => ({}));
  return iaUso.reservar(empresaId, st.ia_respostas_mes == null ? null : Number(st.ia_respostas_mes));
}

// POST /api/atendimento/conversas/:id/sugerir  -> { sugestao }
exports.sugerir = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Conversa inválida" });
    const [[conversa]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });
    if (!ia.disponivel()) return res.status(503).json({ error: "Sugestão por IA não está disponível neste servidor." });
    const cfg = await auto.obterAutomacao(req.empresa_id);
    if (!cfg.ia_sugestao) return res.status(403).json({ error: "A sugestão por IA está desligada. Ative em Resposta automática." });
    const ctx = await montarContexto(req.empresa_id, conversa);
    let reservou = false;
    if (await temRecurso(req.empresa_id, "ia")) { // com o recurso, a sugestao tambem conta no limite mensal
      const r = await reservarCota(req.empresa_id);
      if (!r) return res.status(429).json({ error: "O limite mensal de respostas da IA foi atingido." });
      reservou = true;
    }
    let sugestao;
    try { sugestao = await ia.sugerirResposta(ctx); } catch (e) { if (reservou) await iaUso.devolver(req.empresa_id); throw e; }
    res.json({ sugestao });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[atendimento] sugestao IA:", err.response?.status || err.message);
    res.status(502).json({ error: "Não foi possível gerar a sugestão agora. Tente de novo." });
  }
};

// POST /api/atendimento/conversas/:id/ia { acao: resumir|melhorar|traduzir|etiquetar, texto?, idioma? }
// Exige chave no servidor + liberacao da empresa (ia_sugestao) + recurso `ia` do plano; cada chamada conta 1 resposta do mes.
exports.acaoIa = async (req, res) => {
  let reservou = false;
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Conversa inválida" });
    const acao = typeof req.body?.acao === "string" ? req.body.acao : "";
    if (!ia.ACOES.includes(acao)) return res.status(400).json({ error: "Ação de IA inválida" });
    const [[conversa]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });
    if (!ia.disponivel()) return res.status(503).json({ error: "A IA não está disponível neste servidor." });
    const cfg = await auto.obterAutomacao(req.empresa_id);
    if (!cfg.ia_sugestao) return res.status(403).json({ error: "A IA do atendimento está desligada. Ative em Resposta automática." });
    if (!(await temRecurso(req.empresa_id, "ia"))) return res.status(403).json({ code: "RECURSO_NAO_CONTRATADO", error: "O Atendente com IA não está incluído no seu plano." });
    let ctx = { texto: req.body?.texto, idioma: req.body?.idioma };
    if (acao === "etiquetar") {
      const [et] = await db.query("SELECT id, nome FROM whatsapp_etiquetas WHERE empresa_id = ? ORDER BY nome LIMIT 50", [req.empresa_id]).catch(() => [[]]);
      ctx.etiquetas = et;
    }
    if (acao === "resumir" || acao === "etiquetar") ctx = { ...(await montarContexto(req.empresa_id, conversa)), ...ctx };
    ia.montarPedido(acao, ctx); // valida a entrada ANTES de gastar cota
    if (!(await reservarCota(req.empresa_id))) return res.status(429).json({ error: "O limite mensal de respostas da IA foi atingido." });
    reservou = true;
    try {
      const r = await ia.executarAcao(acao, ctx);
      await iaUso.registrarTokens(req.empresa_id, r.tokens.entrada, r.tokens.saida);
      reservou = false;
      if (acao === "etiquetar") return res.json({ etiquetas: (ctx.etiquetas || []).filter((e) => r.etiquetas.includes(Number(e.id))) });
      return res.json({ resultado: r.texto });
    } catch (e) {
      if (e.tokens) await iaUso.registrarTokens(req.empresa_id, e.tokens.entrada, e.tokens.saida);
      throw e;
    }
  } catch (err) {
    if (reservou) await iaUso.devolver(req.empresa_id);
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[atendimento] acao IA:", err.response?.status || err.message);
    res.status(502).json({ error: "Não foi possível usar a IA agora. Tente de novo." });
  }
};

exports.lerPeriodo = lerPeriodo;
