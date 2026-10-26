const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/campanhasController');
const { validarCampanhaDoUpload, receberArquivo } = require('../middleware/uploadCampanha');

// CRUD campanhas
router.get('/', ctrl.listar);
router.post('/', ctrl.criar);
router.get('/:id', ctrl.obter);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.deletar);
router.get('/:id/metricas', ctrl.metricas);

// IMPORTANT: declare /reordenar BEFORE /:itemId to avoid Express capturing "reordenar" as itemId
router.put('/:id/itens/reordenar', ctrl.reordenar);

// Itens
router.post('/:id/itens', validarCampanhaDoUpload, receberArquivo, ctrl.uploadItem);
router.put('/:id/itens/:itemId', ctrl.atualizarItem);
router.delete('/:id/itens/:itemId', ctrl.deletarItem);

module.exports = router;
