const db = require("../../db");
const { ehDonoPlataforma, limparCacheDono } = require("../utils/donoPlataforma");

// Qualquer usuario autenticado: o front usa para mostrar/esconder as areas da plataforma.
exports.eu = async (req, res) => {
  try {
    res.json({ dono: await ehDonoPlataforma(req.user.id, req.user.role) });
  } catch (err) {
    console.error("[plataforma] eu:", err.message);
    res.json({ dono: false });
  }
};

// Dono: lista os super admins e quem tem o perfil.
exports.listarDonos = async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT id, email, nome, dono_plataforma FROM admins WHERE role = 'super_admin' ORDER BY id");
    res.json(rows.map((a) => ({ id: a.id, email: a.email, nome: a.nome, dono: Number(a.dono_plataforma) === 1 })));
  } catch (err) {
    console.error("[plataforma] listarDonos:", err.message);
    res.status(500).json({ message: "Erro ao listar. Rode a migration 042." });
  }
};

// Dono: da ou remove o perfil. Alvo precisa ser super_admin; nunca remove o ultimo dono.
exports.definirDono = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const dono = req.body && req.body.dono === true;
    if (!id) return res.status(400).json({ message: "Usuário inválido." });
    const [[alvo]] = await db.execute("SELECT id, dono_plataforma FROM admins WHERE id = ? AND role = 'super_admin'", [id]);
    if (!alvo) return res.status(404).json({ message: "Só super admins podem receber este perfil." });
    if (!dono && Number(alvo.dono_plataforma) === 1) {
      const [[r]] = await db.execute("SELECT COUNT(*) AS n FROM admins WHERE dono_plataforma = 1 AND role = 'super_admin'");
      if (r.n <= 1) return res.status(409).json({ message: "Não é possível remover o último dono da plataforma." });
    }
    await db.execute("UPDATE admins SET dono_plataforma = ? WHERE id = ?", [dono ? 1 : 0, id]);
    limparCacheDono();
    res.json({ message: dono ? "Perfil de dono concedido." : "Perfil de dono removido." });
  } catch (err) {
    console.error("[plataforma] definirDono:", err.message);
    res.status(500).json({ message: "Erro ao salvar. Rode a migration 042." });
  }
};
