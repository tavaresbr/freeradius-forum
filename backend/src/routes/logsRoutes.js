const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const exigeDonoPlataforma = require("../middleware/exigeDonoPlataforma");
const {
  getPm2Logs,
  getRadiusLogs,
  clearPm2Logs,
  clearRadiusLogs,
  getServicosStatus,
} = require("../controllers/logsController");

// Somente super_admin pode ver/limpar logs do sistema
router.use(auth, authorize("super_admin"), exigeDonoPlataforma);

router.get("/pm2", getPm2Logs);
router.get("/radius", getRadiusLogs);
router.post("/pm2/clear", clearPm2Logs);
router.post("/radius/clear", clearRadiusLogs);
router.get("/status", getServicosStatus);

module.exports = router;
