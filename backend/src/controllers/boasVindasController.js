// Config das mensagens automaticas da plataforma (so dono da plataforma): GET/PUT /api/plataforma/boas-vindas
// e POST /api/plataforma/boas-vindas/teste.
const { instanciaConectada, enviarMensagemEstrita } = require("./whatsappController");
const { normalizarTelefone, renderTemplate } = require("../services/whatsappNotify");
const { obterConfig, salvarConfig, plataformaId } = require("../services/boasVindasEmpresa");
const { validarConfig, montarVars, linkPainelDaEmpresa } = require("../utils/boasVindas");

exports.obter = async (req, res) => {
  try {
    const config = await obterConfig();
    res.json({ config, whatsapp_conectado: await instanciaConectada(plataformaId()) });
  } catch (err) {
    console.error("[boas-vindas] obter:", err.message);
    res.status(500).json({ message: "Erro ao carregar a configuração." });
  }
};

exports.salvar = async (req, res) => {
  try {
    const { erro, config } = validarConfig(req.body);
    if (erro) return res.status(400).json({ message: erro });
    await salvarConfig(config);
    res.json({ message: "Configuração salva.", config });
  } catch (err) {
    console.error("[boas-vindas] salvar:", err.message);
    res.status(500).json({ message: "Erro ao salvar." });
  }
};

// Teste com dados de exemplo para um numero informado (a mensagem aparece como sera enviada).
exports.teste = async (req, res) => {
  try {
    const tel = normalizarTelefone(req.body && req.body.telefone);
    if (!tel) return res.status(400).json({ message: "Informe um telefone válido com DDD." });
    const tipo = req.body.tipo === "lembrete" ? "lembrete" : "boas_vindas";
    const salvo = await obterConfig();
    const modelo = typeof req.body.mensagem === "string" && req.body.mensagem.trim().length >= 10 ? req.body.mensagem : (tipo === "lembrete" ? salvo.lembrete_ativacao.mensagem : salvo.mensagem);
    if (!(await instanciaConectada(plataformaId()))) return res.status(409).json({ message: "O WhatsApp da plataforma não está conectado." });
    const vars = montarVars({ empresa: { nome: "Maria Exemplo" }, plano: "Popular", trialAte: new Date(Date.now() + 7 * 86400000), linkPainel: linkPainelDaEmpresa("exemplo") });
    await enviarMensagemEstrita(tel, renderTemplate(modelo.slice(0, 1000), vars), plataformaId());
    res.json({ message: "Mensagem de teste enviada." });
  } catch (err) {
    console.error("[boas-vindas] teste:", err.message);
    res.status(502).json({ message: "Não foi possível enviar o teste." });
  }
};
