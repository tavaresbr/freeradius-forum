const express = require("express")
const router = express.Router()
const { login } = require("../src/controllers/authController")

// Login alternativo (legado): usa o MESMO fluxo de /api/auth/login (vinculo em admin_empresas,
// empresa ativa, role por empresa). Antes tinha uma copia propria sem essas checagens.
router.post('/login', login)

module.exports = router
