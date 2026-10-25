const db = require("../../db");
const { validarCPF } = require("../utils/cpf");
const { resolverTextoLgpd } = require("../utils/leadUtils");

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const texto = (v, max) => String(v || "").trim().slice(0, max);

// Empresa dona dos leads do site institucional: vem do ambiente, nunca do body.
function empresaDoSite() {
  const id = parseInt(process.env.SITE_EMPRESA_ID, 10);
  return Number.isInteger(id) && id > 0 ? id : 1;
}

function validarPedido(b = {}) {
  const d = {
    plano: texto(b.plano, 100),
    nome: texto(b.nome, 150),
    cpf: soDigitos(b.cpf),
    telefone: soDigitos(b.telefone),
    email: texto(b.email, 150).toLowerCase(),
    cep: soDigitos(b.cep),
    logradouro: texto(b.logradouro, 255),
    numero: texto(b.numero, 20),
    bairro: texto(b.bairro, 100),
    cidade: texto(b.cidade, 100),
    uf: texto(b.uf, 2).toUpperCase(),
    observacao: texto(b.observacao, 500),
  };
  let erro = null;
  if (!d.plano) erro = "Escolha um plano.";
  else if (d.nome.length < 3) erro = "Informe seu nome completo.";
  else if (!validarCPF(d.cpf)) erro = "CPF invalido.";
  else if (d.telefone.length < 10 || d.telefone.length > 13) erro = "Telefone invalido.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) erro = "E-mail invalido.";
  else if (d.cep.length !== 8) erro = "CEP invalido.";
  else if (!d.logradouro || !d.numero || !d.bairro || !d.cidade || d.uf.length !== 2) erro = "Preencha o endereco completo.";
  else if (b.lgpd_aceite !== true) erro = "E necessario aceitar o termo de privacidade.";
  return { dados: d, erro };
}

exports.criarPedido = async (req, res) => {
  try {
    // honeypot: bots preenchem; resposta de sucesso falsa para nao dar pista
    if (req.body && req.body.website) return res.json({ success: true });

    const { dados: d, erro } = validarPedido(req.body);
    if (erro) return res.status(400).json({ error: erro });

    const empresaId = empresaDoSite();
    const linha = `[Pedido site ${new Date().toISOString().slice(0, 10)}] Plano: ${d.plano}${d.observacao ? ` | Obs: ${d.observacao}` : ""}`;

    const [[existente]] = await db.execute(
      "SELECT id FROM leads WHERE empresa_id = ? AND cpf = ? LIMIT 1",
      [empresaId, d.cpf]
    );
    if (existente) {
      // Nao sobrescreve dados do cadastro (pode ser titular de hotspot): so registra o novo pedido
      await db.execute(
        "UPDATE leads SET observacoes = CONCAT_WS('\n', NULLIF(observacoes, ''), ?) WHERE id = ? AND empresa_id = ?",
        [linha, existente.id, empresaId]
      );
      return res.json({ success: true });
    }

    const termo = await resolverTextoLgpd({ empresaId });
    await db.execute(
      `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, cep, logradouro, numero, bairro, cidade, uf,
                          origem, status, observacoes, lgpd_aceite, lgpd_aceite_em, lgpd_termo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'site', 'novo', ?, 1, NOW(), ?)`,
      [empresaId, d.nome, d.email, d.telefone, d.cpf, d.cep, d.logradouro, d.numero, d.bairro, d.cidade, d.uf, linha, termo]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar pedido do site:", err.message);
    res.status(500).json({ error: "Nao foi possivel enviar seu pedido. Tente novamente." });
  }
};

exports.validarPedido = validarPedido;
