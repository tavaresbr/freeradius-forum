const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/campanhasPublicController');
const { campanhaMetricaLimiter } = require('../middleware/rateLimiters');

router.get('/:portalId', ctrl.obterPorPortal);
// Metricas: limiter proprio por IP (um estabelecimento = um IP para muitos clientes, por isso folgado)
router.post('/:portalId/view', campanhaMetricaLimiter, ctrl.registrarView);
router.post('/:portalId/clique', campanhaMetricaLimiter, ctrl.registrarClique);

module.exports = router;
