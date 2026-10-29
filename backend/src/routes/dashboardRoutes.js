const express = require("express");
const router = express.Router();
const { getDashboard, getHoje } = require("../controllers/dashboardController");

router.get("/", getDashboard);
router.get("/hoje", getHoje);

module.exports = router;
