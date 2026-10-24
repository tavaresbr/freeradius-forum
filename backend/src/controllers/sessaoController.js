const db = require("../../db");
const { validarCPF } = require("../utils/cpf");
const { normalizarDataNascimento } = require("../utils/dataNascimento");
const { conferirDataNascimento, verificarLeadExistente, usernamePertenceAoLead } = require("../utils/leadUtils");
const { buscarSessaoAtiva, desconectarSessao } = require("../utils/sessaoAtiva");

/**
 * POST /api/sessao/desconectar-anterior (publico, com os mesmos limitadores do consulta-cpf)
 * Corpo: { cpf, data_nascimento, username, mac, mikrotik_id }
 *
 * Derruba a sessao anterior do username para o cliente conectar em outro aparelho.
 * Segundo fator obrigatorio: CPF + data de nascimento conferem (conferirDataNascimento === 'ok';
 * 'reivindicado'/'ausente' NAO bastam) e o username precisa ser o do proprio titular
 * (o CPF, ou telefone/e-mail/MAC do lead dele). Empresa vem do equipamento, nunca do cliente.
 * Nao apaga credenciais nem saldo.
 */
exports.desconectarAnterior = async (req, res) => {
  try {
    const { cpf, data_nascimento, username, mac, mikrotik_id } = req.body || {};
    const dataIso = normalizarDataNascimento(data_nascimento);
    if (typeof cpf !== "string" || !validarCPF(cpf) || !dataIso || typeof username !== "string" || !username) {
      return res.status(400).json({ message: "Informe CPF, data de nascimento e usuário válidos" });
    }

    const mtkId = Number(mikrotik_id);
    let empresaId = null;
    if (Number.isInteger(mtkId) && mtkId > 0) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mtkId]);
      empresaId = mtk?.empresa_id || null;
    }
    if (!empresaId) return res.status(400).json({ message: "Equipamento inválido" });

    const cpfLimpo = cpf.replace(/\D/g, "");
    const conf = await conferirDataNascimento(cpfLimpo, empresaId, data_nascimento, { mac, ip: req.ip });
    if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
    if (conf !== "ok") {
      return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
    }

    // O username precisa ser o do titular: o proprio CPF ou o telefone/e-mail/MAC do lead dele
    const lead = await verificarLeadExistente(cpfLimpo, empresaId);
    if (username !== cpfLimpo && !(lead && usernamePertenceAoLead(lead, username))) {
      return res.status(403).json({ message: "Usuário não pertence a este cadastro." });
    }

    const sessao = await buscarSessaoAtiva(username, empresaId);
    if (!sessao) return res.json({ success: true, desconectado: false });

    const r = await desconectarSessao({ sessao, username, empresaId });
    if (!r.ok) {
      return res.status(502).json({ message: "Não foi possível desconectar o outro aparelho agora. Aguarde alguns minutos ou peça ajuda ao atendimento." });
    }
    console.log(`[sessao] desconexao da sessao anterior empresa=${empresaId} metodo=${r.metodo}`);
    return res.json({ success: true, desconectado: true });
  } catch (err) {
    console.error("Erro ao desconectar sessão anterior:", err.message);
    return res.status(500).json({ message: "Erro interno ao desconectar a sessão anterior" });
  }
};
