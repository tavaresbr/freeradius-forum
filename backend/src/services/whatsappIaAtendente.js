// Atendente por IA (Claude) do WhatsApp (desligado por padrao). Roda em segundo plano a partir de registrarMensagem,
// DEPOIS do chatbot de menu e ANTES da resposta automatica: se tratou a mensagem, a automatica nao dispara.
// Nunca responde: mensagens da empresa, midia, "SAIR", opt-out/nao perturbe, conversa com atendente, conversa em que a
// equipe respondeu nas ultimas 12 h ou que foi entregue a um humano, fora de `quando`, acima do limite por conversa
// ou do limite mensal do plano. Falha/recusa/limite => entrega a um humano, nunca fica mudo nem manda texto cortado.
// As ferramentas nao recebem empresa/CPF/telefone do modelo: tudo vem da conversa, no servidor. Sem ferramenta financeira.
const crypto = require("crypto");
const db = require("../../db");
const naoPerturbe = require("../utils/naoPerturbe");
const { temRecurso, obterStatus } = require("../utils/assinatura");
const { temColuna } = require("../utils/schemaCache");
const { verificarSaldoRadius } = require("../utils/leadUtils");
const { linkPlanosDoCliente } = require("../utils/linkPlanos");
const horario = require("../utils/horarioAtendimento");
const cfgIa = require("../utils/iaAtendente");
const claude = require("./claudeClient");
const iaUso = require("./iaUso");
const auto = require("./whatsappAutomacao");
const { limparDados } = require("./sugestaoIA");

const JANELA_HUMANO_H = 12;
const MAX_ITERACOES = 4;
const MAX_MSGS = 20;
const emAndamento = new Set(); // conversas sendo respondidas agora (evita duas respostas para mensagens simultaneas)

const ehSair = (t) => String(t || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "") === "sair";
const soDigitos = (v) => String(v || "").replace(/\D/g, "");

async function leadDaConversa(empresaId, conv) {
  if (!conv?.lead_id) return null;
  const [[l]] = await db.query("SELECT id, cpf FROM leads WHERE id = ? AND empresa_id = ?", [conv.lead_id, empresaId]);
  return l || null;
}

// ---- ferramentas (somente leitura, escopadas pela conversa) ----
async function ferramentaSaldo(ctx) {
  if (ctx.simulado) return { situacao: "ativo", minutos_restantes: 45, observacao: "dados de exemplo (teste)" };
  const cpf = soDigitos((await leadDaConversa(ctx.empresaId, ctx.conv))?.cpf);
  if (!cpf) return { situacao: "sem_cadastro" };
  const sd = await verificarSaldoRadius(cpf);
  if (!sd.existe) return { situacao: "sem_acesso" };
  if (!sd.temSaldo) return { situacao: "tempo_esgotado" };
  return { situacao: "ativo", minutos_restantes: Math.max(1, Math.ceil((sd.tempoRestante || 0) / 60)) };
}

async function ferramentaUltimoPagamento(ctx) {
  if (ctx.simulado) return { encontrado: true, plano: "Plano exemplo", valor_reais: 5, situacao: "approved", data: "2026-01-01", observacao: "dados de exemplo (teste)" };
  const lead = await leadDaConversa(ctx.empresaId, ctx.conv);
  const cpf = soDigitos(lead?.cpf);
  if (!lead && !cpf) return { encontrado: false };
  const [[p]] = await db.query(
    `SELECT p.status, p.valor, p.criado_em, pl.nome AS plano FROM pagamentos p LEFT JOIN planos pl ON pl.id = p.plano_id
      WHERE p.empresa_id = ? AND (p.cliente_id = ? OR (? <> '' AND REPLACE(REPLACE(REPLACE(p.cpf,'.',''),'-',''),' ','') = ?))
      ORDER BY p.id DESC LIMIT 1`,
    [ctx.empresaId, lead?.id || 0, cpf, cpf]
  );
  if (!p) return { encontrado: false };
  return { encontrado: true, plano: p.plano || null, valor_reais: Number(p.valor || 0) / 100, situacao: p.status, data: p.criado_em ? new Date(p.criado_em).toISOString().slice(0, 10) : null };
}

async function ferramentaLinkPlanos(ctx) {
  if (ctx.simulado) return { link: "https://exemplo.com/planos (link de exemplo)" };
  const lead = await leadDaConversa(ctx.empresaId, ctx.conv);
  const cpf = soDigitos(lead?.cpf);
  let nasId = null;
  if (cpf) {
    const [[ru]] = await db.query("SELECT nas_id FROM radius_users WHERE empresa_id = ? AND username = ? LIMIT 1", [ctx.empresaId, cpf]);
    nasId = ru?.nas_id || null;
  }
  const link = await linkPlanosDoCliente(ctx.empresaId, { clienteId: lead?.id, nasId });
  return link ? { link } : { erro: "link_indisponivel" };
}

async function executarFerramenta(nome, input, ctx) {
  try {
    if (nome === "consultar_saldo") return await ferramentaSaldo(ctx);
    if (nome === "ver_ultimo_pagamento") return await ferramentaUltimoPagamento(ctx);
    if (nome === "link_planos") return await ferramentaLinkPlanos(ctx);
    if (nome === "chamar_atendente") {
      ctx.transferir = { motivo: limparDados(input?.motivo).slice(0, 150) || "sem motivo informado" };
      return { ok: true, observacao: "A conversa será entregue a um atendente." };
    }
    return { erro: "ferramenta_desconhecida" };
  } catch (err) {
    console.warn("[ia-atendente] ferramenta falhou:", nome, err.message);
    return { erro: "indisponivel" };
  }
}

/**
 * Nucleo: roda o loop com o Claude. Nao envia nada, nao grava nada (so le pelas ferramentas).
 * @returns {Promise<{texto?: string, transferir?: {motivo: string}, falha?: string, ferramentas: string[], tokens: {entrada: number, saida: number}}>}
 */
async function executar(cfg, ctx, historico, empresaNome) {
  const cliente = claude.obterCliente();
  const system = [{ type: "text", text: cfgIa.montarSystem(cfg, { empresa: empresaNome }), cache_control: { type: "ephemeral" } }];
  const mensagens = historico.map((h) => ({ role: h.role, content: h.texto }));
  const usadas = [];
  const tokens = { entrada: 0, saida: 0 };
  for (let i = 0; i < MAX_ITERACOES + 1; i += 1) {
    const resp = await cliente.messages.create({
      model: claude.modeloAtendente(), max_tokens: 1500, output_config: { effort: "low" },
      system, tools: cfgIa.FERRAMENTAS, tool_choice: { type: "auto" }, messages: mensagens,
    });
    const t = claude.tokensDe(resp); tokens.entrada += t.entrada; tokens.saida += t.saida;
    if (resp.stop_reason === "refusal") return { falha: "recusa", ferramentas: usadas, tokens };
    if (resp.stop_reason === "tool_use") {
      if (i >= MAX_ITERACOES) return { falha: "ferramentas_demais", ferramentas: usadas, tokens };
      mensagens.push({ role: "assistant", content: resp.content });
      const resultados = [];
      for (const b of resp.content.filter((x) => x.type === "tool_use")) {
        usadas.push(b.name);
        const r = await executarFerramenta(b.name, b.input, ctx);
        resultados.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r) });
      }
      mensagens.push({ role: "user", content: resultados });
      continue;
    }
    if (ctx.transferir) return { transferir: ctx.transferir, ferramentas: usadas, tokens };
    if (resp.stop_reason !== "end_turn") return { falha: resp.stop_reason || "inesperado", ferramentas: usadas, tokens };
    const texto = claude.textoDe(resp);
    if (!texto) return { falha: "vazia", ferramentas: usadas, tokens };
    return { texto: texto.slice(0, 1500), ferramentas: usadas, tokens };
  }
  return { falha: "ferramentas_demais", ferramentas: usadas, tokens };
}

/** Historico mascarado, alternando papeis e terminando na mensagem do cliente. */
function montarHistorico(linhas) {
  const out = [];
  for (const l of linhas) {
    if ((l.direcao !== "in" && l.direcao !== "out") || !l.texto) continue;
    const role = l.direcao === "in" ? "user" : "assistant";
    const texto = limparDados(l.texto);
    if (!texto) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].texto += `\n${texto}`;
    else out.push({ role, texto });
  }
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

async function nomeDaEmpresa(empresaId) {
  const [[e]] = await db.query("SELECT nome FROM empresas WHERE id = ?", [empresaId]);
  return e?.nome || "";
}

async function enviar(empresaId, conv, texto) {
  const svc = require("./whatsappAtendimento"); // lazy: evita dependencia circular
  const r = await svc.enviarTexto(empresaId, null, conv, texto, { automatica: true });
  if (await temColuna("whatsapp_mensagens", "ia")) {
    await db.query(
      "UPDATE whatsapp_mensagens SET ia = 1 WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out' ORDER BY id DESC LIMIT 1",
      [empresaId, conv.id]
    ).catch(() => {});
  }
  return r;
}

/** Entrega a conversa a um humano: robo calado por 12 h, conversa aberta, nota interna e mensagem ao cliente. */
async function entregarAoHumano(empresaId, conv, cfg, motivo, agora = new Date()) {
  await db.query("UPDATE whatsapp_conversas SET chatbot_estado = 'humano', chatbot_em = NOW(), status = 'aberta' WHERE id = ? AND empresa_id = ?", [conv.id, empresaId]);
  await db.query(
    `INSERT INTO whatsapp_mensagens (empresa_id, conversa_id, wa_id, direcao, tipo, texto, status) VALUES (?, ?, ?, 'nota', 'texto', ?, 'enviada')`,
    [empresaId, conv.id, `nota_${crypto.randomUUID()}`, `🤖 IA passou para um atendente. Motivo: ${String(motivo).slice(0, 200)}`]
  );
  let texto = cfg.msg_transferir;
  try {
    const a = await auto.obterAutomacao(empresaId);
    if (a.ativo && a.usar_horario && a.msg_fora_horario && !horario.dentroDoHorario(a, agora)) {
      texto += `\n\n${horario.renderizar(a.msg_fora_horario, { nome: conv.nome, empresa: "" })}`;
    }
  } catch { /* horario e' opcional */ }
  if (texto) await enviar(empresaId, conv, texto).catch((err) => console.warn("[ia-atendente] aviso de transferencia falhou:", err.message));
}

/**
 * @returns {Promise<{tratada: boolean, motivo?: string}>} tratada = a IA assumiu a mensagem (nao dispara a resposta automatica)
 */
async function processar(empresaId, conversaId, m, agora = new Date()) {
  if (m.fromMe || m.tipo !== "texto" || !m.texto) return { tratada: false, motivo: "ignorada" };
  if (ehSair(m.texto)) return { tratada: false, motivo: "sair" };
  if (!claude.disponivel()) return { tratada: false, motivo: "sem_chave" };
  if (!(await temColuna("whatsapp_conversas", "chatbot_estado"))) return { tratada: false, motivo: "sem_migration" };
  const cfg = cfgIa.mesclarComPadrao((await auto.lerConfigJson(empresaId)).ia_atendente);
  if (!cfg.ativo) return { tratada: false, motivo: "desligado" };
  if (!(await temRecurso(empresaId, "whatsapp")) || !(await temRecurso(empresaId, "ia"))) return { tratada: false, motivo: "sem_recurso" };

  if (cfg.quando === "fora_do_horario") {
    const a = await auto.obterAutomacao(empresaId);
    if (!a.usar_horario || horario.dentroDoHorario(a, agora)) return { tratada: false, motivo: "dentro_do_horario" };
  }

  const [[conv]] = await db.query("SELECT * FROM whatsapp_conversas WHERE id = ? AND empresa_id = ?", [conversaId, empresaId]);
  if (!conv) return { tratada: false, motivo: "sem_conversa" };
  if (conv.atendente_id) return { tratada: false, motivo: "com_atendente" };
  if (conv.chatbot_estado === "humano" && conv.chatbot_em && (agora - new Date(conv.chatbot_em)) < JANELA_HUMANO_H * 3600 * 1000) return { tratada: true, motivo: "humano" };

  const temAuto = await temColuna("whatsapp_mensagens", "automatica");
  const [[humano]] = await db.query(
    `SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out' ${temAuto ? "AND automatica = 0" : ""}
       AND criado_em >= DATE_SUB(NOW(), INTERVAL ${JANELA_HUMANO_H} HOUR)`,
    [empresaId, conversaId]
  );
  if (Number(humano.n) > 0) return { tratada: false, motivo: "equipe_respondeu" };
  if (conv.telefone && (await naoPerturbe.estaBloqueado(empresaId, conv.telefone))) return { tratada: false, motivo: "optout" };

  if (emAndamento.has(`${empresaId}:${conversaId}`)) return { tratada: true, motivo: "em_andamento" };
  emAndamento.add(`${empresaId}:${conversaId}`);
  let reservou = false;
  try {
    const temIa = await temColuna("whatsapp_mensagens", "ia");
    if (temIa) {
      const [[r]] = await db.query(
        "SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out' AND ia = 1 AND criado_em >= DATE_SUB(NOW(), INTERVAL 1 HOUR)",
        [empresaId, conversaId]
      );
      if (Number(r.n) >= cfg.limite_por_conversa_hora) {
        await entregarAoHumano(empresaId, conv, cfg, "limite de respostas da IA por hora nesta conversa", agora);
        return { tratada: true, motivo: "limite_conversa" };
      }
    }
    const st = await obterStatus(empresaId).catch(() => ({}));
    const limite = st.ia_respostas_mes == null ? null : Number(st.ia_respostas_mes);
    reservou = await iaUso.reservar(empresaId, limite);
    if (!reservou) {
      await entregarAoHumano(empresaId, conv, cfg, "limite mensal de respostas da IA atingido", agora);
      return { tratada: true, motivo: "limite_mensal" };
    }

    const [linhas] = await db.query(
      "SELECT direcao, texto FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao IN ('in','out') ORDER BY id DESC LIMIT ?",
      [empresaId, conversaId, MAX_MSGS]
    );
    const historico = montarHistorico((linhas || []).slice().reverse());
    if (!historico.length) { await iaUso.devolver(empresaId); reservou = false; return { tratada: false, motivo: "sem_historico" }; }

    const ctx = { empresaId, conv, simulado: false, transferir: null };
    const empresaNome = await nomeDaEmpresa(empresaId);
    let res;
    try { res = await executar(cfg, ctx, historico, empresaNome); }
    catch (err) { res = { falha: `erro: ${err.status || ""} ${err.message}`.slice(0, 120), ferramentas: [], tokens: { entrada: 0, saida: 0 } }; }
    if (res.tokens?.entrada || res.tokens?.saida) await iaUso.registrarTokens(empresaId, res.tokens.entrada, res.tokens.saida);

    if (res.transferir) {
      await entregarAoHumano(empresaId, conv, cfg, res.transferir.motivo, agora);
      return { tratada: true, motivo: "transferida" };
    }
    if (res.falha) {
      console.warn("[ia-atendente] falha:", res.falha);
      await iaUso.devolver(empresaId); reservou = false;
      await entregarAoHumano(empresaId, conv, cfg, `a IA não conseguiu responder (${res.falha})`, agora);
      return { tratada: true, motivo: "falha" };
    }
    // Primeira resposta da IA nesta conversa: apresenta-se como assistente virtual.
    let texto = res.texto;
    if (temIa) {
      const [[ja]] = await db.query("SELECT COUNT(*) AS n FROM whatsapp_mensagens WHERE empresa_id = ? AND conversa_id = ? AND direcao = 'out' AND ia = 1", [empresaId, conversaId]);
      if (Number(ja.n) === 0 && cfg.msg_identificacao) texto = `${cfgIa.renderizar(cfg.msg_identificacao, { empresa: empresaNome, nome: conv.nome })}\n\n${texto}`;
    }
    try { await enviar(empresaId, conv, texto); }
    catch (err) {
      console.warn("[ia-atendente] envio falhou:", err.message);
      await iaUso.devolver(empresaId); reservou = false;
      return { tratada: false, motivo: "envio_falhou" };
    }
    return { tratada: true, motivo: "respondida" };
  } finally {
    emAndamento.delete(`${empresaId}:${conversaId}`);
  }
}

/** Simulacao para a tela "Testar": nao envia, nao reserva cota, ferramentas com dados de exemplo. */
async function testar(empresaId, cfg, textoCliente) {
  const texto = limparDados(textoCliente);
  if (!texto) throw Object.assign(new Error("Escreva a mensagem do cliente."), { status: 400 });
  const ctx = { empresaId, conv: null, simulado: true, transferir: null };
  const res = await executar(cfg, ctx, [{ role: "user", texto }], await nomeDaEmpresa(empresaId));
  if (res.tokens?.entrada || res.tokens?.saida) await iaUso.registrarTokens(empresaId, res.tokens.entrada, res.tokens.saida);
  return res;
}

module.exports = { processar, testar, executar, montarHistorico, executarFerramenta };
