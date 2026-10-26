const path = require("path");
const fs   = require("fs");
const db   = require("../../db");
const { ALLOWED_MIMES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, UPLOAD_ROOT } = require("../middleware/uploadCampanha");
const v = require("../utils/campanhaValidacao");

// ─────────────────────────────────────────────────────────────────────────────
// CRUD Campanhas
// ─────────────────────────────────────────────────────────────────────────────

exports.listar = async (req, res) => {
  try {
    const [campanhas] = await db.execute(
      `SELECT c.*,
         (SELECT COUNT(*) FROM campanha_itens ci WHERE ci.campanha_id = c.id) AS total_itens,
         (SELECT GROUP_CONCAT(p.nome ORDER BY p.nome SEPARATOR ', ')
            FROM portais p WHERE p.campanha_ativa_id = c.id AND p.empresa_id = c.empresa_id) AS portais_em_uso
       FROM campanhas c
       WHERE c.empresa_id = ?
       ORDER BY c.criado_em DESC`,
      [req.empresa_id]
    );
    res.json({ success: true, data: campanhas });
  } catch (err) {
    console.error("Erro ao listar campanhas:", err);
    res.status(500).json({ error: "Erro ao listar campanhas" });
  }
};

exports.criar = async (req, res) => {
  const nome = v.validarNome(req.body?.nome);
  if (!nome.ok) return res.status(400).json({ error: nome.erro });
  const descricao = v.validarDescricao(req.body?.descricao);
  if (!descricao.ok) return res.status(400).json({ error: descricao.erro });
  try {
    const [result] = await db.execute(
      `INSERT INTO campanhas (empresa_id, nome, descricao) VALUES (?, ?, ?)`,
      [req.empresa_id, nome.valor, descricao.valor]
    );
    const [[campanha]] = await db.execute(
      "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?",
      [result.insertId, req.empresa_id]
    );
    res.status(201).json({ success: true, data: campanha });
  } catch (err) {
    console.error("Erro ao criar campanha:", err);
    res.status(500).json({ error: "Erro ao criar campanha" });
  }
};

exports.obter = async (req, res) => {
  const { id } = req.params;
  try {
    const [[campanha]] = await db.execute(
      "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!campanha) return res.status(404).json({ error: "Campanha não encontrada" });

    const [itens] = await db.execute(
      "SELECT * FROM campanha_itens WHERE campanha_id = ? AND empresa_id = ? ORDER BY ordem ASC, id ASC",
      [id, req.empresa_id]
    );
    res.json({ success: true, data: { ...campanha, itens } });
  } catch (err) {
    console.error("Erro ao obter campanha:", err);
    res.status(500).json({ error: "Erro ao obter campanha" });
  }
};

exports.atualizar = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  // So altera o que veio no corpo; descricao vazia/null LIMPA o campo (antes COALESCE impedia limpar).
  const sets = [];
  const params = [];
  if (v.temCampo(body, "nome")) {
    const nome = v.validarNome(body.nome);
    if (!nome.ok) return res.status(400).json({ error: nome.erro });
    sets.push("nome = ?"); params.push(nome.valor);
  }
  if (v.temCampo(body, "descricao")) {
    const descricao = v.validarDescricao(body.descricao);
    if (!descricao.ok) return res.status(400).json({ error: descricao.erro });
    sets.push("descricao = ?"); params.push(descricao.valor);
  }
  if (v.temCampo(body, "ativo") && body.ativo !== null) {
    sets.push("ativo = ?"); params.push(body.ativo ? 1 : 0);
  }

  try {
    const [[existing]] = await db.execute(
      "SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!existing) return res.status(404).json({ error: "Campanha não encontrada" });

    if (sets.length) {
      await db.execute(
        `UPDATE campanhas SET ${sets.join(", ")}, atualizado_em = NOW() WHERE id = ? AND empresa_id = ?`,
        [...params, id, req.empresa_id]
      );
    }
    const [[campanha]] = await db.execute(
      "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    res.json({ success: true, data: campanha });
  } catch (err) {
    console.error("Erro ao atualizar campanha:", err);
    res.status(500).json({ error: "Erro ao atualizar campanha" });
  }
};

exports.deletar = async (req, res) => {
  const { id } = req.params;
  try {
    const [[campanha]] = await db.execute(
      "SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!campanha) return res.status(404).json({ error: "Campanha não encontrada" });

    // Campanha em uso: excluir zera o pre-portal desses portais (FK SET NULL). Pede confirmacao (?forcar=1).
    const [emUso] = await db.execute(
      "SELECT id, nome FROM portais WHERE campanha_ativa_id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (emUso.length && req.query?.forcar !== "1") {
      return res.status(409).json({
        error: "Esta campanha está em uso por um ou mais portais. Ao excluir, eles ficam sem pré-portal.",
        em_uso: emUso,
      });
    }

    // Banco primeiro: se o DELETE falhar os arquivos continuam la; so depois apaga a pasta.
    await db.execute(
      "DELETE FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    const dir = path.join(UPLOAD_ROOT, String(req.empresa_id), String(id));
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error("Erro ao remover pasta da campanha:", e);
    }
    res.json({ success: true, message: "Campanha removida com sucesso" });
  } catch (err) {
    console.error("Erro ao deletar campanha:", err);
    res.status(500).json({ error: "Erro ao deletar campanha" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Itens
// ─────────────────────────────────────────────────────────────────────────────

async function getCampanhaOuFalha(req, res) {
  const campanhaId = req.params.id;
  const [[campanha]] = await db.execute(
    "SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?",
    [campanhaId, req.empresa_id]
  );
  if (!campanha) {
    res.status(404).json({ error: "Campanha não encontrada" });
    return null;
  }
  return campanha;
}

function removerArquivoUpload(file) {
  if (file && file.path) {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) { /* ignora */ }
  }
}

exports.uploadItem = async (req, res) => {
  try {
    const campanha = await getCampanhaOuFalha(req, res);
    if (!campanha) { removerArquivoUpload(req.file); return; }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const meta = ALLOWED_MIMES[req.file.mimetype];
    if (!meta) {
      removerArquivoUpload(req.file);
      return res.status(400).json({ error: "Tipo de arquivo não permitido" });
    }

    // O mimetype vem do cliente: confere a assinatura real do arquivo
    if (!v.arquivoConfere(req.file.path, req.file.mimetype)) {
      removerArquivoUpload(req.file);
      return res.status(400).json({ error: "O conteúdo do arquivo não corresponde ao tipo informado" });
    }

    // Per-type size validation
    if (meta.tipo === "imagem" && req.file.size > MAX_IMAGE_BYTES) {
      removerArquivoUpload(req.file);
      return res.status(400).json({ error: "Imagem excede o limite de 10 MB" });
    }
    if (meta.tipo === "video" && req.file.size > MAX_VIDEO_BYTES) {
      removerArquivoUpload(req.file);
      return res.status(400).json({ error: "Vídeo excede o limite de 50 MB" });
    }

    const duracao = v.validarDuracao(req.body?.duracao_segundos, { padrao: v.DURACAO_PADRAO });
    const titulo = v.validarTitulo(req.body?.titulo);
    const link = v.validarLink(req.body?.link_destino);
    const invalido = [duracao, titulo, link].find((r) => !r.ok);
    if (invalido) {
      removerArquivoUpload(req.file);
      return res.status(400).json({ error: invalido.erro });
    }

    // Compute next ordem
    const [[ordemRow]] = await db.execute(
      "SELECT IFNULL(MAX(ordem), -1) + 1 AS proxima FROM campanha_itens WHERE campanha_id = ?",
      [campanha.id]
    );
    const ordem = ordemRow.proxima;

    const arquivo_url = `/uploads/campanhas/${req.empresa_id}/${campanha.id}/${req.file.filename}`;

    const [result] = await db.execute(
      `INSERT INTO campanha_itens
         (campanha_id, empresa_id, tipo, arquivo_url, ordem, duracao_segundos, titulo, link_destino)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [campanha.id, req.empresa_id, meta.tipo, arquivo_url, ordem, duracao.valor, titulo.valor, link.valor]
    );
    const [[item]] = await db.execute(
      "SELECT * FROM campanha_itens WHERE id = ? AND empresa_id = ?",
      [result.insertId, req.empresa_id]
    );
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error("Erro ao fazer upload de item:", err);
    removerArquivoUpload(req.file);
    res.status(500).json({ error: "Erro ao fazer upload de item" });
  }
};

exports.atualizarItem = async (req, res) => {
  const { itemId } = req.params;
  const campanhaId = req.params.id;
  const body = req.body || {};

  // So altera o que veio no corpo; titulo/link vazios LIMPAM o campo.
  const sets = [];
  const params = [];
  if (v.temCampo(body, "titulo")) {
    const r = v.validarTitulo(body.titulo);
    if (!r.ok) return res.status(400).json({ error: r.erro });
    sets.push("ci.titulo = ?"); params.push(r.valor);
  }
  if (v.temCampo(body, "duracao_segundos")) {
    const r = v.validarDuracao(body.duracao_segundos);
    if (!r.ok) return res.status(400).json({ error: r.erro });
    sets.push("ci.duracao_segundos = ?"); params.push(r.valor);
  }
  if (v.temCampo(body, "link_destino")) {
    const r = v.validarLink(body.link_destino);
    if (!r.ok) return res.status(400).json({ error: r.erro });
    sets.push("ci.link_destino = ?"); params.push(r.valor);
  }
  if (!sets.length) return res.status(400).json({ error: "Nada para atualizar" });

  try {
    const [result] = await db.execute(
      `UPDATE campanha_itens ci
         JOIN campanhas c ON c.id = ci.campanha_id
         SET ${sets.join(", ")}
       WHERE ci.id = ? AND ci.campanha_id = ? AND c.empresa_id = ?`,
      [...params, itemId, campanhaId, req.empresa_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item não encontrado" });
    }
    const [[item]] = await db.execute(
      "SELECT * FROM campanha_itens WHERE id = ? AND empresa_id = ?",
      [itemId, req.empresa_id]
    );
    res.json({ success: true, data: item });
  } catch (err) {
    console.error("Erro ao atualizar item:", err);
    res.status(500).json({ error: "Erro ao atualizar item" });
  }
};

exports.deletarItem = async (req, res) => {
  const { itemId } = req.params;
  const campanhaId = req.params.id;
  try {
    const [[item]] = await db.execute(
      `SELECT ci.*
         FROM campanha_itens ci
         JOIN campanhas c ON c.id = ci.campanha_id
       WHERE ci.id = ? AND ci.campanha_id = ? AND c.empresa_id = ?`,
      [itemId, campanhaId, req.empresa_id]
    );
    if (!item) return res.status(404).json({ error: "Item não encontrado" });

    // Banco primeiro (se falhar, o arquivo continua la); depois o arquivo, so dentro da pasta de uploads.
    await db.execute(
      "DELETE FROM campanha_itens WHERE id = ? AND empresa_id = ?",
      [itemId, req.empresa_id]
    );
    const filePath = path.join(__dirname, "../.." + item.arquivo_url);
    if (filePath.startsWith(UPLOAD_ROOT + path.sep) && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {
        console.error("Erro ao remover arquivo físico:", e);
      }
    }

    res.json({ success: true, message: "Item removido com sucesso" });
  } catch (err) {
    console.error("Erro ao deletar item:", err);
    res.status(500).json({ error: "Erro ao deletar item" });
  }
};

exports.reordenar = async (req, res) => {
  const campanhaId = req.params.id;
  const { ordens } = req.body || {}; // [{id, ordem}, ...]

  if (!Array.isArray(ordens) || ordens.length === 0) {
    return res.status(400).json({ error: "Campo ordens deve ser um array não vazio" });
  }
  const valido = ordens.every((o) => o && Number.isInteger(Number(o.id)) && Number(o.id) > 0
    && Number.isInteger(Number(o.ordem)) && Number(o.ordem) >= 0);
  if (!valido) {
    return res.status(400).json({ error: "Cada item deve ter id e ordem numéricos" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Verify campanha belongs to this empresa
    const [[campanha]] = await conn.execute(
      "SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?",
      [campanhaId, req.empresa_id]
    );
    if (!campanha) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: "Campanha não encontrada" });
    }

    // Todos os ids precisam ser itens desta campanha (antes os de fora eram ignorados em silencio)
    const [itens] = await conn.execute(
      "SELECT id FROM campanha_itens WHERE campanha_id = ? AND empresa_id = ?",
      [campanhaId, req.empresa_id]
    );
    const doGrupo = new Set(itens.map((i) => Number(i.id)));
    if (!ordens.every((o) => doGrupo.has(Number(o.id)))) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: "Há itens que não pertencem a esta campanha" });
    }

    for (const { id, ordem } of ordens) {
      await conn.execute(
        "UPDATE campanha_itens SET ordem = ? WHERE id = ? AND campanha_id = ? AND empresa_id = ?",
        [Number(ordem), Number(id), campanhaId, req.empresa_id]
      );
    }

    await conn.commit();
    conn.release();
    res.json({ success: true, message: "Itens reordenados com sucesso" });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignora */ }
    conn.release();
    console.error("Erro ao reordenar itens:", err);
    res.status(500).json({ error: "Erro ao reordenar itens" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Metricas (views e cliques por item e por dia)
// ─────────────────────────────────────────────────────────────────────────────

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS_METRICAS = 366;

function ctr(views, cliques) {
  return views > 0 ? Math.round((cliques / views) * 1000) / 10 : 0; // % com 1 casa
}

exports.metricas = async (req, res) => {
  const { id } = req.params;
  const hoje = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const padraoDe = new Date(hoje.getTime() - 29 * 24 * 3600 * 1000);
  const de = req.query.de || fmt(padraoDe);
  const ate = req.query.ate || fmt(hoje);

  if (!DIA_RE.test(de) || !DIA_RE.test(ate) || Number.isNaN(Date.parse(de)) || Number.isNaN(Date.parse(ate))) {
    return res.status(400).json({ error: "Período inválido. Use datas no formato AAAA-MM-DD" });
  }
  const dias = (Date.parse(ate) - Date.parse(de)) / (24 * 3600 * 1000) + 1;
  if (dias < 1 || dias > MAX_DIAS_METRICAS) {
    return res.status(400).json({ error: `O período deve ter entre 1 e ${MAX_DIAS_METRICAS} dias` });
  }

  try {
    const [[campanha]] = await db.execute(
      "SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );
    if (!campanha) return res.status(404).json({ error: "Campanha não encontrada" });

    const [linhas] = await db.execute(
      `SELECT m.item_id, DATE_FORMAT(m.dia, '%Y-%m-%d') AS dia, m.views, m.cliques
         FROM campanha_metricas m
        WHERE m.campanha_id = ? AND m.empresa_id = ? AND m.dia BETWEEN ? AND ?`,
      [id, req.empresa_id, de, ate]
    );
    const [itens] = await db.execute(
      "SELECT id, titulo, tipo, arquivo_url, ordem FROM campanha_itens WHERE campanha_id = ? AND empresa_id = ? ORDER BY ordem ASC, id ASC",
      [id, req.empresa_id]
    );

    // item_id = 0 e' o total da campanha; os demais sao por item
    const porDia = new Map();
    const porItem = new Map(itens.map((i) => [i.id, { item_id: i.id, titulo: i.titulo, tipo: i.tipo, arquivo_url: i.arquivo_url, views: 0, cliques: 0, removido: false }]));
    let views = 0;
    let cliques = 0;
    for (const l of linhas) {
      const v = Number(l.views) || 0;
      const c = Number(l.cliques) || 0;
      if (Number(l.item_id) === 0) {
        views += v; cliques += c;
        const d = porDia.get(l.dia) || { dia: l.dia, views: 0, cliques: 0 };
        d.views += v; d.cliques += c;
        porDia.set(l.dia, d);
      } else {
        const it = porItem.get(Number(l.item_id)) || { item_id: Number(l.item_id), titulo: null, tipo: null, arquivo_url: null, views: 0, cliques: 0, removido: true };
        it.views += v; it.cliques += c;
        porItem.set(it.item_id, it);
      }
    }

    res.json({
      success: true,
      data: {
        de, ate,
        resumo: { views, cliques, ctr: ctr(views, cliques) },
        por_dia: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
        por_item: [...porItem.values()].map((i) => ({ ...i, ctr: ctr(i.views, i.cliques) })),
      },
    });
  } catch (err) {
    console.error("Erro ao obter métricas da campanha:", err);
    res.status(500).json({ error: "Erro ao obter métricas" });
  }
};
