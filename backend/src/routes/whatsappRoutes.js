const express = require("express");
const router = express.Router();
const { enviarMensagem, getInstanceStatus, createInstance, getQrCode, deleteInstance, restartInstance, logoutInstance, saveConfig, getConfig, ativarWebhookInstancia, statusWebhookInstancia, listarLogs, limparLogs } = require("../controllers/whatsappController");

router.post("/send", enviarMensagem);
router.get("/instance/status", getInstanceStatus);
router.post("/instance/create", createInstance);
router.get("/instance/qrcode", getQrCode);
router.delete("/instance/delete", deleteInstance);
router.post("/instance/restart", restartInstance);
router.post("/instance/logout", logoutInstance);
router.post("/webhook/ativar", ativarWebhookInstancia);
router.get("/webhook/status", statusWebhookInstancia);
router.get("/config", getConfig);
router.post("/config", saveConfig);
router.get("/logs", listarLogs);
router.delete("/logs", limparLogs);

module.exports = router;
