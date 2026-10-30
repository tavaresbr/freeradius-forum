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
  gerarTokenDownload,
  baixarBackup,
} = require('../controllers/systemBackupController');

// Publica de proposito: quem autoriza e' o token de 60 s emitido abaixo a um dono da plataforma.
router.get('/download', baixarBackup);

router.use(auth, authorize('super_admin'), exigeDonoPlataforma);

router.get('/', listarBackups);
router.post('/', criarBackup);
router.post('/restore/:id', restaurarBackup);
router.post('/:id/download-token', gerarTokenDownload);
router.delete('/:id', deletarBackup);

module.exports = router;
