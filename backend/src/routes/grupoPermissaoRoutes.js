const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const {
  listarGrupos, obterGrupo, criarGrupo, atualizarGrupo, deletarGrupo,
  listarAdminsGrupo, vincularAdmin, desvincularAdmin,
  obterPermissoesAdmin, listarModulos
} = require("../controllers/grupoPermissaoController");
const { listarTodosAdmins } = require("../controllers/empresaController");

// Tabelas grupos_permissao/admin_grupos sao globais (sem empresa_id): apenas
// super_admin pode gerir, senao owner de uma empresa afetaria todas as outras.
router.use(auth, authorize('super_admin'));

router.get("/modulos", listarModulos);
router.get("/", listarGrupos);
router.post("/", criarGrupo);
router.get("/admins/todos", listarTodosAdmins);
router.get("/admin/:adminId/permissoes", obterPermissoesAdmin);
router.get("/:id", obterGrupo);
router.put("/:id", atualizarGrupo);
router.delete("/:id", deletarGrupo);
router.get("/:id/admins", listarAdminsGrupo);
router.post("/:id/vincular-admin", vincularAdmin);
router.delete("/:id/desvincular-admin/:adminId", desvincularAdmin);

module.exports = router;
