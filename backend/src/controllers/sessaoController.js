const db = require("../../db");
const { validarCPF } = require("../utils/cpf");
const { normalizarDataNascimento } = require("../utils/dataNascimento");
const { conferirDataNascimento, verificarLeadExistente, usernamePertenceAoLead, podeReceberCredenciais, acessoEhGratis, dispositivoJaUsouAcesso } = require("../utils/leadUtils");
const loginTentativas = require("../utils/loginTentativas");
const { ehSenhaLegada } = require("../utils/radiusPassword");
const { buscarSessaoAtiva, desconectarSessao, pagamentoRecenteDoAparelho } = require("../utils/sessaoAtiva");

/**
 * POST /api/sessao/desconectar-anterior (publico, com os mesmos limitadores do consulta-cpf)
 * Corpo: { cpf, data_nascimento, username, mac, mikrotik_id }  — portais de cadastro (CPF + data de nascimento)
 *    ou: { username, password, mac, mikrotik_id }                — tela de login (usuario + senha, ver desconectarPorSenha)
 *
 * Derruba a sessao anterior do username para o cliente conectar em outro aparelho.
 * Segundo fator obrigatorio: CPF + data de nascimento conferem (conferirDataNascimento === 'ok';
 * 'reivindicado'/'ausente' NAO bastam) e o username precisa ser o do proprio titular
 * (o CPF, ou telefone/e-mail/MAC do lead dele). Empresa vem do equipamento, nunca do cliente.
 * Nao apaga credenciais nem saldo.
 */
// Trecho final comum aos dois modos: acha a sessao aberta e a derruba (nunca apaga credenciais/saldo).
async function derrubarSessaoAnterior(res, { username, empresaId }) {
  const sessao = await buscarSessaoAtiva(username, empresaId);
  if (!sessao) return res.json({ success: true, desconectado: false });

  const r = await desconectarSessao({ sessao, username, empresaId });
  if (!r.ok) {
    return res.status(502).json({ message: "Não foi possível desconectar o outro aparelho agora. Aguarde alguns minutos ou peça ajuda ao atendimento." });
  }
  console.log(`[sessao] desconexao da sessao anterior empresa=${empresaId} metodo=${r.metodo}`);
  return res.json({ success: true, desconectado: true });
}

// Mesma resposta para usuario inexistente e senha errada (como o login do portal): nao deixa enumerar acessos.
const MSG_CREDENCIAIS = "Usuário ou senha inválidos";

/**
 * Modo usuario + senha (tela LoginHotspot): a prova de titularidade e' a mesma do login do portal
 * (/api/login-portal/auth): senha do radcheck, limite de tentativas, senha legada so em aparelho
 * que ja usou o acesso e acesso da mesma empresa do equipamento.
 */
async function desconectarPorSenha(req, res) {
  const { username: usernameRaw, password: passwordRaw, mac, mikrotik_id } = req.body || {};
  if (typeof usernameRaw !== "string" || typeof passwordRaw !== "string" || !usernameRaw || !passwordRaw) {
    return res.status(400).json({ message: "Informe usuário e senha" });
  }

  const mtkId = Number(mikrotik_id);
  let empresaId = null;
  if (Number.isInteger(mtkId) && mtkId > 0) {
    const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mtkId]);
    empresaId = mtk?.empresa_id || null;
  }
  if (!empresaId) return res.status(400).json({ message: "Equipamento inválido" });

  const usernameTrim = usernameRaw.trim();
  const passwordTrim = passwordRaw.trim();
  const userDigits = usernameTrim.replace(/\D/g, "");
  const passDigits = passwordTrim.replace(/\D/g, "");
  const candidatos = [usernameTrim];
  if (userDigits.length === 11 && userDigits !== usernameTrim) candidatos.push(userDigits);

  const ctxTent = { username: userDigits.length === 11 ? userDigits : usernameTrim, ip: req.ip };
  if (loginTentativas.bloqueado(ctxTent)) return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
  const negar = () => { loginTentativas.registrarFalha(ctxTent); return res.status(401).json({ message: MSG_CREDENCIAIS }); };

  let user = null;
  let username = usernameTrim;
  for (const cand of candidatos) {
    const [[row]] = await db.execute("SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password'", [cand]);
    if (row) { user = row; username = cand; break; }
  }
  if (!user) return negar();
  if (!(user.value === passwordTrim || (passDigits.length === 11 && user.value === passDigits))) return negar();
  if (ehSenhaLegada(username, user.value) && !(await dispositivoJaUsouAcesso(username, mac))) return negar();

  // Multi-tenant: o acesso pertence a uma empresa (radius_users); nao derruba sessao de outra empresa
  const [[dono]] = await db.query("SELECT empresa_id FROM radius_users WHERE username = ? LIMIT 1", [username]);
  if (dono && Number(dono.empresa_id) !== Number(empresaId)) return negar();

  loginTentativas.limparUsuario(ctxTent);
  return derrubarSessaoAnterior(res, { username, empresaId });
}

exports.desconectarAnterior = async (req, res) => {
  try {
    if (req.body && typeof req.body.password === "string") return await desconectarPorSenha(req, res);
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

    // Em CPF sem pagamento a data nao prova nada (quem reivindica a grava e volta com ela): derrubar
    // um acesso que nao e' o plano gratis dos portais exige que o aparelho ja o tenha usado.
    // Quem acabou de pagar (PIX/cartao) tambem pode: o acesso e' pago e o aparelho novo nunca usou o username.
    if (!(await podeReceberCredenciais({ cpf: cpfLimpo, username, mac, empresaId })) && !(await acessoEhGratis(username))
        && !(await pagamentoRecenteDoAparelho({ cpf: cpfLimpo, mac, empresaId }))) {
      return res.status(403).json({ message: "Não foi possível confirmar que este aparelho é o do titular." });
    }

    return await derrubarSessaoAnterior(res, { username, empresaId });
  } catch (err) {
    console.error("Erro ao desconectar sessão anterior:", err.message);
    return res.status(500).json({ message: "Erro interno ao desconectar a sessão anterior" });
  }
};
