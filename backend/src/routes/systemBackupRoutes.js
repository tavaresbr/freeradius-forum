const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const exigeDonoPlataforma = require('../middleware/exigeDonoPlataforma');
const {
  listarBackups,
  criarBackup,
  restaurarBackup,
  deletarBackup,
} = require('../controllers/systemBackupController');

router.use(auth, authorize('super_admin'), exigeDonoPlataforma);

router.get('/', listarBackups);
router.post('/', criarBackup);
router.post('/restore/:id', restaurarBackup);
router.delete('/:id', deletarBackup);

module.exports = router;
