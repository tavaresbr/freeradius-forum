const express = require("express");
const multer = require("multer");
const c = require("../controllers/atendimentoController");
const x = require("../controllers/atendimentoExtrasController");
const au = require("../controllers/atendimentoAutomacaoController");
const rel = require("../controllers/atendimentoRelatoriosController");
const contatos = require("../controllers/atendimentoContatosController");
const np = require("../controllers/naoPerturbeController");
const { sugestaoIaLimiter, atendimentoEnvioLimiter, novaConversaLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

// Arquivo so em memoria (validado e gravado pelo servico); limite do WhatsApp para midia: 16 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
const comArquivo = (req, res, next) => upload.single("arquivo")(req, res, (err) => {
  if (!err) return next();
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Arquivo muito grande (máximo 16 MB)" : "Arquivo inválido" });
});

router.get("/conversas", c.listarConversas);
router.get("/conversas/:id/mensagens", c.listarMensagens);
router.post("/conversas/:id/mensagens", atendimentoEnvioLimiter, c.enviarMensagem);
router.post("/conversas/:id/midia", atendimentoEnvioLimiter, comArquivo, c.enviarMidia);
router.get("/midia/:id", c.servirMidia);
router.put("/conversas/:id", c.atualizarConversa);
router.post("/conversas/:id/lida", c.marcarLida);
router.get("/nao-lidas", c.naoLidas);

// Dia a dia: dono da conversa, localizacao e contato
router.get("/atendentes", x.listarAtendentes);
router.post("/conversas/:id/assumir", x.assumirConversa);
router.post("/conversas/:id/transferir", x.transferirConversa);
router.post("/conversas/:id/localizacao", atendimentoEnvioLimiter, x.enviarLocalizacao);
router.post("/conversas/:id/contato", atendimentoEnvioLimiter, x.enviarContato);
router.post("/webhook/garantir", c.garantirWebhook);

// Automacao: resposta automatica (horario) e mensagens agendadas / lembretes
router.get("/automacao", au.obterAutomacao);
router.put("/automacao", au.salvarAutomacao);
router.get("/conversas/:id/agendadas", au.listarAgendadas);
router.post("/conversas/:id/agendadas", au.criarAgendada);
router.delete("/agendadas/:id", au.cancelarAgendada);

// Receita: aviso "seu tempo esta acabando"
router.get("/relatorios", rel.relatorios);
router.get("/ia-status", rel.iaStatus);
router.post("/conversas/:id/sugerir", sugestaoIaLimiter, rel.sugerir);
router.get("/chatbot", au.obterChatbot);
router.put("/chatbot", au.salvarChatbot);
router.get("/pos-compra", au.obterPosCompra);
router.put("/pos-compra", au.salvarPosCompra);
router.get("/renovacao/relatorio", au.relatorioRenovacao);
router.get("/renovacao", au.obterRenovacao);
router.put("/renovacao", au.salvarRenovacao);
router.get("/aviso-expiracao", au.obterAviso);
router.put("/aviso-expiracao", au.salvarAviso);
router.post("/aviso-expiracao/teste", atendimentoEnvioLimiter, au.testarAviso);

// Fase 3: notas, etiquetas, respostas rapidas, painel do cliente, nova conversa
router.get("/contatos", contatos.listarContatos);
router.post("/conversas", novaConversaLimiter, x.novaConversa);
router.post("/conversas/:id/notas", x.criarNota);
router.put("/conversas/:id/etiquetas", x.definirEtiquetasDaConversa);
router.get("/conversas/:id/cliente", x.clienteDaConversa);
router.post("/conversas/:id/vincular", x.vincularCliente);
router.post("/conversas/:id/criar-cliente", x.criarClienteDaConversa);
router.get("/clientes", x.buscarClientes);
router.get("/etiquetas", x.listarEtiquetas);
router.post("/etiquetas", x.criarEtiqueta);
router.put("/etiquetas/:id", x.atualizarEtiqueta);
router.delete("/etiquetas/:id", x.excluirEtiqueta);
router.get("/respostas-rapidas", x.listarRespostas);
router.post("/respostas-rapidas/padrao", x.criarModelosPadrao);
router.post("/respostas-rapidas", x.criarResposta);
router.put("/respostas-rapidas/:id", x.atualizarResposta);
router.delete("/respostas-rapidas/:id", x.excluirResposta);

// Nao perturbe: lista central + horario de silencio
router.get("/nao-perturbe/config", np.obterConfig);
router.put("/nao-perturbe/config", np.salvarConfig);
router.get("/nao-perturbe/export", np.exportar);
router.post("/nao-perturbe/importar", novaConversaLimiter, np.importar);
router.get("/nao-perturbe", np.listar);
router.post("/nao-perturbe", np.adicionar);
router.delete("/nao-perturbe/:id", np.remover);

module.exports = router;
