// Cupons de desconto: CRUD do painel (Administrador) e validacao publica do portal.
// Valores em centavos. Todo calculo fica em utils/cupons (servidor).
const db = require("../../db");
const c = require("../utils/cupons");

const erro500 = (res, err, msg) => {
  if (err.code === "ER_NO_SUCH_TABLE") return res.status(503).json({ error: "Recurso indisponível: rode a migration 060 (node migrations/060_cupons.js)." });
  console.error("[cupons]", err.message);
  return res.status(500).json({ error: msg });
};

async function planoDaEmpresa(planoId, empresaId) {
  if (planoId == null) return true;
  const [[p]] = await db.query("SELECT id FROM planos WHERE id = ? AND empresa_id = ?", [planoId, empresaId]);
  return !!p;
}

// GET /api/cupons
exports.listar = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.codigo, c.tipo, c.valor, c.plano_id, p.nome AS plano_nome, c.valido_ate, c.max_usos, c.usos, c.ativo, c.criado_em
         FROM cupons c LEFT JOIN planos p ON p.id = c.plano_id AND p.empresa_id = c.empresa_id
        WHERE c.empresa_id = ? ORDER BY c.id DESC LIMIT 500`,
      [req.empresa_id]
    );
    res.json(rows);
  } catch (err) { erro500(res, err, "Erro ao listar cupons"); }
};

// POST /api/cupons
exports.criar = async (req, res) => {
  try {
    const d = c.validarCupomAdmin(req.body);
    if (!(await planoDaEmpresa(d.plano_id, req.empresa_id))) return res.status(400).json({ error: "Plano inválido" });
    const [r] = await db.query(
      "INSERT INTO cupons (empresa_id, codigo, tipo, valor, plano_id, valido_ate, max_usos, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.empresa_id, d.codigo, d.tipo, d.valor, d.plano_id, d.valido_ate, d.max_usos, d.ativo]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Já existe um cupom com este código" });
    erro500(res, err, "Erro ao criar o cupom");
  }
};

// PUT /api/cupons/:id
exports.atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Cupom inválido" });
    const d = c.validarCupomAdmin(req.body);
    if (!(await planoDaEmpresa(d.plano_id, req.empresa_id))) return res.status(400).json({ error: "Plano inválido" });
    const [r] = await db.query(
      "UPDATE cupons SET codigo = ?, tipo = ?, valor = ?, plano_id = ?, valido_ate = ?, max_usos = ?, ativo = ? WHERE id = ? AND empresa_id = ?",
      [d.codigo, d.tipo, d.valor, d.plano_id, d.valido_ate, d.max_usos, d.ativo, id, req.empresa_id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Cupom não encontrado" });
    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Já existe um cupom com este código" });
    erro500(res, err, "Erro ao salvar o cupom");
  }
};

// DELETE /api/cupons/:id  (cupom ja usado so pode ser desativado: o historico de pagamentos aponta para ele)
exports.excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Cupom inválido" });
    const [[uso]] = await db.query("SELECT COUNT(*) AS n FROM pagamentos WHERE cupom_id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (Number(uso.n) > 0) return res.status(409).json({ error: "Este cupom já foi usado. Desative-o em vez de excluir." });
    const [r] = await db.query("DELETE FROM cupons WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!r.affectedRows) return res.status(404).json({ error: "Cupom não encontrado" });
    res.json({ success: true });
  } catch (err) { erro500(res, err, "Erro ao excluir o cupom"); }
};

// POST /api/cupom-portal/validar { plano_id, codigo, cpf? }  (publico; so mostra o novo valor, nada e' gravado)
exports.validarPublico = async (req, res) => {
  try {
    const planoId = Number(req.body?.plano_id);
    if (!Number.isInteger(planoId) || planoId < 1) return res.status(400).json({ message: c.MSG_INVALIDO });
    const [[plano]] = await db.query("SELECT id, empresa_id, valor FROM planos WHERE id = ?", [planoId]);
    if (!plano) return res.status(400).json({ message: c.MSG_INVALIDO });
    const r = await c.resolverCupom({ empresaId: plano.empresa_id, plano, codigo: req.body?.codigo, cpf: req.body?.cpf });
    if (!r.ok) return res.status(400).json({ message: c.MSG_INVALIDO });
    res.json({ valor_original: r.valor_original, desconto: r.desconto, valor_final: r.valor_final });
  } catch (err) {
    console.error("[cupons] validar:", err.message);
    res.status(400).json({ message: c.MSG_INVALIDO });
  }
};
