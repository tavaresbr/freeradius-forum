const express = require("express");
const router = express.Router();
const {
  listarAdmins,
  listarPerfis,
  criarAdmin,
  atualizarAdmin,
  deletarAdmin,
} = require("../controllers/adminController");

router.get("/", listarAdmins);
router.get("/perfis", listarPerfis);
router.post("/", criarAdmin);
router.put("/:id", atualizarAdmin);
router.delete("/:id", deletarAdmin);

module.exports = router;