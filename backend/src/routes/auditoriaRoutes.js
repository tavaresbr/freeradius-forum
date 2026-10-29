const express = require("express");
const { listar } = require("../controllers/auditoriaController");

const router = express.Router();
router.get("/", listar);

module.exports = router;
