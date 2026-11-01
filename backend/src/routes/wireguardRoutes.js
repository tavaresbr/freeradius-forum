const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const controller = require('../controllers/wireguardController');

router.get('/status', controller.getVpnStatus);
router.get('/settings', controller.getServerSettings);
// Edita o docker-compose.yml GLOBAL do WireGuard e reinicia o container: so a plataforma (super_admin).
router.put('/settings', authorize('super_admin'), controller.updateServerSettings);
router.post('/clients', controller.createClient);
router.put('/clients/:id', controller.renameClient);
router.delete('/clients/:id', controller.deleteClient);
router.get('/clients/:id/config', controller.getClientConfig);

module.exports = router;
