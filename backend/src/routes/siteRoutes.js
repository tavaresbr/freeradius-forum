const express = require("express");
const router = express.Router();
const controller = require("../controllers/siteController");

router.post("/pedido", controller.criarPedido);

module.exports = router;
