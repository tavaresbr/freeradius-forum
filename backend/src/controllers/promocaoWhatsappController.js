// Promocoes por WhatsApp (admin): previa, criar fila, iniciar/pausar/retomar/cancelar, listar e detalhar.
// O envio em si e' feito por src/jobs/enviaPromocoes.js (fila com intervalo entre mensagens).
const db = require("../../db");
const { instanciaConectada, enviarMensagemEstrita } = require("./whatsappController");
const { normalizarTelefone } = require("../services/whatsappNotify");
const p = require("../utils/promocaoWhatsapp");

const MSG_DESCONECTADO = "O WhatsApp da empresa não está conectado. Conecte a instância na tela WhatsApp e tente de novo.";

async function carregarEnvio(id, empresaId) {
  const [[envio]] = await db.execute("SELECT * FROM promocao_envios WHERE id = ? AND empresa_id = ?", [id, empresaId]);
  return envio || null;
}

// Contadores a partir dos destinatarios (fonte da verdade; nao depende de incrementos).
async function recontar(envioId) {
  const [rows] = await db.execute(
    "SELECT status, COUNT(*) AS n FROM promocao_destinatarios WHERE envio_id = ? GROUP BY status",
    [envioId]
  );
  const c = { enviado: 0, erro: 0, ignorado: 0, pendente: 0 };
  for (const r of rows) c[r.status] = Number(r.n);
  await db.execute(
    "UPDATE promocao_envios SET enviados = ?, falhas = ?, ignorados = ? WHERE id = ?",
    [c.enviado, c.erro, c.ignorado, envioId]
  );
  return c;
}

exports.previa = async (req, res) => {
  const v = p.validarEnvio({ nome: req.body?.nome || "previa", mensagem: req.body?.mensagem });
  if (!v.ok) return res.status(400).json({ error: v.erro });
  try {
    const sel = await p.selecionarDestinatarios(db, req.body?.filtros, req.empresa_id);
    const amostra = sel.destinatarios.slice(0, 5).map((d) => ({ nome: d.nome, telefone: p.mascararTelefone(d.telefone) }));
    res.json({
      success: true,
      data: {
        total: sel.destinatarios.length,
        invalidos: sel.invalidos,
        duplicados: sel.duplicados,
        excedeu: sel.excedeu,
        limite: sel.limite,
        amostra,
        mensagem_exemplo: p.montarMensagem(v.mensagem, sel.destinatarios[0]?.nome),
      },
    });
  } catch (err) {
    console.error("Erro na previa de promocao:", err);
    res.status(500).json({ error: "Erro ao calcular a prévia" });
  }
};

exports.criar = async (req, res) => {
  const v = p.validarEnvio(req.body);
  if (!v.ok) return res.status(400).json({ error: v.erro });
  try {
    const sel = await p.selecionarDestinatarios(db, req.body?.filtros, req.empresa_id);
    if (!sel.destinatarios.length) return res.status(400).json({ error: "Nenhum contato elegível com esses filtros" });

    const [r] = await db.execute(
      `INSERT INTO promocao_envios (empresa_id, nome, mensagem, filtros_json, status, total, criado_por)
       VALUES (?, ?, ?, ?, 'rascunho', ?, ?)`,
      [req.empresa_id, v.nome, v.mensagem, JSON.stringify(sel.filtros), sel.destinatarios.length, req.user?.id || null]
    );
    const envioId = r.insertId;
    for (let i = 0; i < sel.destinatarios.length; i += 500) {
      const lote = sel.destinatarios.slice(i, i + 500);
      await db.query(
        "INSERT INTO promocao_destinatarios (envio_id, empresa_id, lead_id, telefone, nome) VALUES ?",
        [lote.map((d) => [envioId, req.empresa_id, d.lead_id, d.telefone, d.nome])]
      );
    }
    res.status(201).json({ success: true, data: await carregarEnvio(envioId, req.empresa_id) });
  } catch (err) {
    console.error("Erro ao criar promocao:", err);
    res.status(500).json({ error: "Erro ao criar a promoção" });
  }
};

// iniciar (rascunho) e retomar (pausada): exigem WhatsApp conectado
async function ativar(req, res, deQuais) {
  try {
    const envio = await carregarEnvio(req.params.id, req.empresa_id);
    if (!envio) return res.status(404).json({ error: "Promoção não encontrada" });
    if (!deQuais.includes(envio.status)) return res.status(409).json({ error: `Não dá para fazer isso numa promoção ${envio.status}` });
    if (!(await instanciaConectada(req.empresa_id))) return res.status(409).json({ error: MSG_DESCONECTADO });
    await db.execute(
      "UPDATE promocao_envios SET status = 'em_andamento', iniciado_em = COALESCE(iniciado_em, NOW()) WHERE id = ? AND empresa_id = ?",
      [envio.id, req.empresa_id]
    );
    res.json({ success: true, data: await carregarEnvio(envio.id, req.empresa_id) });
  } catch (err) {
    console.error("Erro ao iniciar promocao:", err);
    res.status(500).json({ error: "Erro ao iniciar a promoção" });
  }
}
exports.iniciar = (req, res) => ativar(req, res, ["rascunho"]);
exports.retomar = (req, res) => ativar(req, res, ["pausada"]);

exports.pausar = async (req, res) => {
  try {
    const envio = await carregarEnvio(req.params.id, req.empresa_id);
    if (!envio) return res.status(404).json({ error: "Promoção não encontrada" });
    if (envio.status !== "em_andamento") return res.status(409).json({ error: "Só dá para pausar uma promoção em andamento" });
    await db.execute("UPDATE promocao_envios SET status = 'pausada' WHERE id = ? AND empresa_id = ?", [envio.id, req.empresa_id]);
    res.json({ success: true, data: await carregarEnvio(envio.id, req.empresa_id) });
  } catch (err) {
    console.error("Erro ao pausar promocao:", err);
    res.status(500).json({ error: "Erro ao pausar a promoção" });
  }
};

exports.cancelar = async (req, res) => {
  try {
    const envio = await carregarEnvio(req.params.id, req.empresa_id);
    if (!envio) return res.status(404).json({ error: "Promoção não encontrada" });
    if (["concluida", "cancelada"].includes(envio.status)) return res.status(409).json({ error: "Esta promoção já terminou" });
    await db.execute("UPDATE promocao_envios SET status = 'cancelada', concluido_em = NOW() WHERE id = ? AND empresa_id = ?", [envio.id, req.empresa_id]);
    await db.execute(
      "UPDATE promocao_destinatarios SET status = 'ignorado', erro_msg = 'Cancelado' WHERE envio_id = ? AND empresa_id = ? AND status = 'pendente'",
      [envio.id, req.empresa_id]
    );
    await recontar(envio.id);
    res.json({ success: true, data: await carregarEnvio(envio.id, req.empresa_id) });
  } catch (err) {
    console.error("Erro ao cancelar promocao:", err);
    res.status(500).json({ error: "Erro ao cancelar a promoção" });
  }
};

exports.listar = async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, nome, status, total, enviados, falhas, ignorados, criado_em, iniciado_em, concluido_em FROM promocao_envios WHERE empresa_id = ? ORDER BY id DESC LIMIT 100",
      [req.empresa_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Erro ao listar promocoes:", err);
    res.status(500).json({ error: "Erro ao listar promoções" });
  }
};

exports.obter = async (req, res) => {
  try {
    const envio = await carregarEnvio(req.params.id, req.empresa_id);
    if (!envio) return res.status(404).json({ error: "Promoção não encontrada" });
    const [erros] = await db.execute(
      "SELECT telefone, nome, erro_msg FROM promocao_destinatarios WHERE envio_id = ? AND empresa_id = ? AND status = 'erro' ORDER BY id DESC LIMIT 20",
      [envio.id, req.empresa_id]
    );
    res.json({ success: true, data: { ...envio, erros: erros.map((e) => ({ ...e, telefone: p.mascararTelefone(e.telefone) })) } });
  } catch (err) {
    console.error("Erro ao obter promocao:", err);
    res.status(500).json({ error: "Erro ao obter a promoção" });
  }
};

// Envia a mensagem (com o rodape) para UM numero, para o admin conferir antes de disparar.
exports.testar = async (req, res) => {
  const v = p.validarEnvio({ nome: "teste", mensagem: req.body?.mensagem });
  if (!v.ok) return res.status(400).json({ error: v.erro });
  const tel = normalizarTelefone(req.body?.telefone);
  if (!tel) return res.status(400).json({ error: "Telefone inválido (use DDD + número)" });
  try {
    if (!(await instanciaConectada(req.empresa_id))) return res.status(409).json({ error: MSG_DESCONECTADO });
    await enviarMensagemEstrita(tel, p.montarMensagem(v.mensagem, "Cliente Teste"), req.empresa_id);
    res.json({ success: true });
  } catch (err) {
    console.error("Erro no teste de promocao:", err.message);
    res.status(502).json({ error: "Não foi possível enviar o teste. Confira a conexão do WhatsApp." });
  }
};

exports.recontar = recontar;
