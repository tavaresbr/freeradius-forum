const express = require("express");
const c = require("../controllers/cuponsController");

const router = express.Router();
router.get("/", c.listar);
router.post("/", c.criar);
router.put("/:id", c.atualizar);
router.delete("/:id", c.excluir);

module.exports = router;
