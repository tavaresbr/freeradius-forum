const db = require("../../db");
const { gerarSenhaRadius } = require("../utils/radiusPassword");
const { verificarLeadExistente, gravarDataNascimento, mesmoDispositivo, verificarSaldoRadius, conferirDataNascimento, usernamePertenceAoLead, bloqueiaReliberacao, MSG_ACESSO_ATIVO, bloqueiaPagamentoAlheio, MSG_PAGAMENTO_ALHEIO, atualizarLeadExistente, resolverTextoLgpd } = require("../utils/leadUtils");
const { notificarLiberacao } = require("../services/whatsappNotify");
const { montarGatewayInfo } = require("../gateways/gatewayLiberacao");
const { resolverApDoContexto } = require("../utils/apInfo");
const { validarCPF } = require("../utils/cpf");
const { tratarSessaoAtiva } = require("../utils/sessaoAtiva");
const { camposFaltando, mensagemFaltando } = require("../utils/cadastroObrigatorio");
const { formatarTelefone, formatarCep, normalizarDataImport } = require("../utils/importCadastros");

// Captura de lead sem liberar internet
exports.capturaPassiva = async (req, res) => {
  try {
    const { nome, email, telefone, cpf, mac, ip, mikrotik_id } = req.body;

    if (!telefone && !email) {
      return res.status(400).json({ message: "Telefone ou email são obrigatórios" });
    }

    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }

    const cpfLimpo = cpf ? cpf.replace(/\D/g, "") : null;

    // AP/SSID onde o cliente esta conectado (contexto salvo no redirect)
    const apInfo = await resolverApDoContexto(mikrotik_id, mac);

    // Reconexao por CPF: se ja existe, atualiza o lead em vez de bloquear (409).
    let leadJaRegistrado = false;
    let titularVerificado = false;
    if (cpf) {
      const existing = await verificarLeadExistente(cpf, empresaId);
      if (existing) {
        leadJaRegistrado = true;
        await atualizarLeadExistente(existing.id, empresaId, {
          nome, email, telefone, mac, ip, ap_mac: apInfo.apMac, ssid: apInfo.ssid,
        });
      }
    }

    if (!leadJaRegistrado) {
      await db.execute(
        `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, ap_mac, ssid, origem, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal_passivo', 'novo')`,
        [empresaId, nome || null, email || null, telefone || null, cpfLimpo, mac || null, ip || null, apInfo.apMac, apInfo.ssid]
      );
    }

    // Buscar config de redirect do portal lead_passivo desta empresa
    let redirectUrl = null;
    let redirectDelay = 3;
    if (empresaId) {
      const [[portal]] = await db.execute(
        "SELECT configuracoes FROM portais WHERE tipo = 'lead_passivo' AND empresa_id = ? LIMIT 1",
        [empresaId]
      );
      if (portal?.configuracoes) {
        try {
          const cfg = JSON.parse(portal.configuracoes);
          if (cfg.redirect_portal_url) {
            redirectUrl = cfg.redirect_portal_url;
            redirectDelay = cfg.redirect_delay || 3;
          }
        } catch (e) {}
      }
    }

    // Notificacao WhatsApp (lead passivo nao libera RADIUS, mas pode mandar mensagem)
    let portalIdPassivo = null;
    if (empresaId) {
      try {
        const [[portalP]] = await db.execute(
          "SELECT id FROM portais WHERE tipo = 'lead_passivo' AND empresa_id = ? LIMIT 1",
          [empresaId]
        );
        portalIdPassivo = portalP?.id || null;
      } catch (_) {}
    }

    notificarLiberacao({
      empresa_id: empresaId,
      portal_id: portalIdPassivo,
      mikrotik_id: mikrotik_id || null,
      telefone: telefone || null,
      cpf: cpfLimpo || null,
      mac: mac || null,
      contexto_tipo: "lead_passivo",
      vars: {
        nome: nome || null,
        cpf: cpfLimpo || "",
      },
    }).catch(err => console.warn("[capturaPassiva] notificarLiberacao falhou:", err.message));

    return res.json({
      success: true,
      message: "Lead cadastrado com sucesso!",
      redirect_url: redirectUrl,
      redirect_delay: redirectDelay,
    });
  } catch (err) {
    console.error("Erro Captura Passiva Lead:", err);
    return res.status(500).json({ message: "Erro interno ao processar cadastro de Lead" });
  }
};


// Login público para portal Lead (cria RADIUS + retorna gateway)
exports.leadLogin = async (req, res) => {
  try {
    const { nome, email, telefone, cpf, mac, ip, mikrotik_id, data_nascimento } = req.body;

    if (!mac || !ip) {
      return res.status(400).json({ message: "MAC e IP são obrigatórios" });
    }

    // Resolver empresa_id via mikrotik_id
    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }

    // Username: usar telefone limpo, ou email, ou MAC
    const telLimpo = telefone ? telefone.replace(/\D/g, '') : null;
    const username = telLimpo || email || mac;
    const senha = gerarSenhaRadius(); // aleatoria; devolvida ao frontend/WhatsApp

    // Busca plano Lead da empresa
    let planoQuery = `
      SELECT p.id, p.duracao_minutos, p.velocidade_down, p.velocidade_up, p.mikrotik_id, p.shared_users, m.end_hotspot
      FROM planos p
      JOIN mikrotiks m ON p.mikrotik_id = m.id
      WHERE LOWER(p.nome) = 'lead'`;
    const planoParams = [];

    if (empresaId) {
      planoQuery += ` AND p.empresa_id = ?`;
      planoParams.push(empresaId);
    }

    planoQuery += ` LIMIT 1`;
    const [[plano]] = await db.query(planoQuery, planoParams);

    if (!plano) {
      return res.status(404).json({ message: "Plano Lead não configurado. Crie um plano com nome 'Lead'." });
    }

    // Snapshot do termo exibido no portal (prova LGPD de qual texto foi aceito)
    const termoLgpd = await resolverTextoLgpd({ mikrotikId: mikrotik_id, empresaId, tipoPortal: "lead" });

    // AP/SSID onde o cliente esta conectado (contexto salvo no redirect)
    const apInfo = await resolverApDoContexto(mikrotik_id, mac);

    // Reconexao por CPF: se ja existe, NAO bloqueia. Atualiza o lead (novo aceite)
    // e, se ainda ha saldo, devolve credenciais pra reconectar. Se esgotou, segue
    // o fluxo normal de re-liberacao sem duplicar lead.
    let leadJaRegistrado = false;
    if (cpf) {
      const existing = await verificarLeadExistente(cpf, empresaId);
      if (existing) {
        leadJaRegistrado = true;
        // Segundo fator: sem a data de nascimento correta nao ha reconexao nem
        // alteracao do cadastro (o CPF sozinho e' publico/adivinhavel).
        await gravarDataNascimento(cpf, empresaId, data_nascimento, { permitirLeadExistente: mesmoDispositivo(existing, mac) });
        const conf = await conferirDataNascimento(cpf, empresaId, data_nascimento, { mac, ip: req.ip });
        if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
        if (conf === "divergente") {
          return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
        }
        const verificado = conf === "ok";
        // 'reivindicado' = CPF sem pagamento confirmado, cadastro provisorio: o contato passa a ser
        // o de quem se cadastrou agora, mas NAO prova titularidade (nada de credenciais existentes).
        const reivindicado = conf === "reivindicado";
        // Username deste fluxo e' telefone/e-mail/MAC: so devolve credencial se for o do proprio lead
        const usernameDoLead = verificado && usernamePertenceAoLead(existing, username);
        titularVerificado = usernameDoLead;
        // Cadastro legado sem data: registra so o novo aceite (nao troca contato/MAC de quem nao se provou)
        await atualizarLeadExistente(existing.id, empresaId, (verificado || reivindicado)
          ? { nome, email, telefone, mac, ip, aceite: 1, termo: termoLgpd, ap_mac: apInfo.apMac, ssid: apInfo.ssid }
          : { aceite: 1, termo: termoLgpd });

        const saldo = usernameDoLead ? await verificarSaldoRadius(username) : { temSaldo: false };
        if (saldo.temSaldo) {
          const gatewaySaldo = plano.end_hotspot || ip;
          return res.json({
            success: true,
            gateway: gatewaySaldo,
            username,
            password: saldo.password,
            existente: true,
            tempoRestante: saldo.tempoRestante,
            // Sessao aberta em outro aparelho: o portal oferece "desconectar a anterior e conectar aqui"
            ...(await tratarSessaoAtiva({ username, mac, empresaId })),
            gateway_info: await montarGatewayInfo({
              mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username,
            }),
          });
        }
        // Sem saldo: segue para re-liberacao abaixo.
      }
    }

    // Re-liberar troca senha e plano do username (telefone/e-mail/MAC): recusa se ele ja
    // tem acesso ativo e nao e' o username do titular verificado deste lead.
    if (await bloqueiaReliberacao({ username, titularVerificado, usernameEhMac: username === mac })) {
      return res.status(409).json({ message: MSG_ACESSO_ATIVO, requer_data_nascimento: true });
    }

    // Salvar lead — apenas se novo CPF
    if (!leadJaRegistrado) {
      try {
        await db.execute(
          `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, ap_mac, ssid, origem, lgpd_aceite, lgpd_aceite_em, lgpd_termo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal_lead', 1, NOW(), ?)`,
          [empresaId, nome || null, email || null, telefone || null, cpf || null, mac || null, ip || null, apInfo.apMac, apInfo.ssid, termoLgpd]
        );
        await gravarDataNascimento(cpf, empresaId, data_nascimento);
      } catch (leadErr) {
        console.warn("Aviso: erro ao inserir lead:", leadErr.message);
      }
    }

    // Remove autenticacoes antigas
    await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
    await db.query("DELETE FROM radreply WHERE username = ?", [username]);
    await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);
    // Reseta o contador total via timestamp (sqlcounter soma radacct com
    // acctstarttime >= liberado_em). Historico do radacct preservado (Marco Civil).
    await db.query(`UPDATE radius_users SET liberado_em = NOW() WHERE username = ?`, [username]);

    const rateLimit = `${plano.velocidade_up}M/${plano.velocidade_down}M`;
    const tempoSegundos = plano.duracao_minutos * 60;

    // Max-All-Session (sqlcounter 'totalcounter', reset=never) + 1 sessao unica
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Cleartext-Password', ':=', ?),
              (?, 'Max-All-Session', ':=', ?),
              (?, 'Simultaneous-Use', ':=', '1')`,
      [username, senha, username, String(tempoSegundos), username]
    );

    // WISPr-Bandwidth-Max-*: rate limit em bps aplicado por vendors nao-MikroTik
    // (Omada/UniFi honram no Access-Accept). O MikroTik ignora estes e usa o
    // Mikrotik-Rate-Limit acima — seguro enviar ambos sempre.
    const upBps = Math.round(Number(plano.velocidade_up) * 1000000);
    const downBps = Math.round(Number(plano.velocidade_down) * 1000000);
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value)
       VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?),
              (?, 'Session-Timeout', ':=', ?),
              (?, 'WISPr-Bandwidth-Max-Up', ':=', ?),
              (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [username, rateLimit, username, tempoSegundos, username, String(upBps), username, String(downBps)]
    );

    await db.query(
      "INSERT INTO radusergroup (username, groupname) VALUES (?, ?)",
      [username, plano.id]
    );

    // liberado_em = NOW() no INSERT e no UPDATE: sem isso o primeiro cadastro
    // fica com liberado_em NULL e o sqlcounter passa a somar o consumo
    // vitalicio (franquia nunca renova a partir do 2o ciclo).
    await db.query(
      `INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), nas_id = VALUES(nas_id), empresa_id = VALUES(empresa_id), liberado_em = NOW()`,
      [empresaId, username, plano.id, plano.mikrotik_id]
    );

    const gateway = plano.end_hotspot || ip;
    const loginUrl = gateway ? `http://${gateway}/login?username=${username}&password=${senha}` : "";

    // Resolver portal_id Lead da empresa para notificacao WhatsApp
    let portalId = null;
    if (empresaId) {
      try {
        const [[portalLead]] = await db.execute(
          "SELECT id FROM portais WHERE tipo = 'lead' AND empresa_id = ? LIMIT 1",
          [empresaId]
        );
        portalId = portalLead?.id || null;
      } catch (_) {}
    }

    notificarLiberacao({
      empresa_id: empresaId,
      portal_id: portalId,
      mikrotik_id: plano.mikrotik_id,
      telefone: telefone || null,
      cpf: cpf ? cpf.replace(/\D/g, "") : null,
      mac,
      contexto_tipo: "lead",
      vars: {
        nome: nome || null,
        username,
        password: senha,
        plano: "Lead",
        duracao: plano.duracao_minutos,
        velocidade: `${plano.velocidade_down}M/${plano.velocidade_up}M`,
        login_url: loginUrl,
        cpf: cpf ? cpf.replace(/\D/g, "") : "",
      },
    }).catch(err => console.warn("[leadLogin] notificarLiberacao falhou:", err.message));

    return res.json({
      success: true, gateway, username, password: senha,
      gateway_info: await montarGatewayInfo({
        mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username,
        duracaoSegundos: tempoSegundos,
      }),
    });
  } catch (err) {
    console.error("Erro Lead Login:", err);
    return res.status(500).json({ message: "Erro interno ao processar login Lead" });
  }
};

// Campos do cadastro completo aceitos no CRUD manual (alem de nome/email/telefone/cpf/status/observacoes)
const CAMPOS_TEXTO = {
  rg: 30, cnpj: 20, razao_social: 255, logradouro: 255, numero: 20, complemento: 100,
  bairro: 100, cidade: 100, id_externo: 64,
};
const STATUS_VALIDOS = ["novo", "contactado", "convertido", "descartado"];

/**
 * Limpa o corpo do CRUD: so devolve as chaves enviadas, ja normalizadas.
 * @returns {{dados?: Object, erro?: string}}
 */
function sanitizarCadastro(body) {
  const d = {};
  const tem = (k) => body[k] !== undefined;
  const txt = (v, max) => { const s = v == null ? "" : String(v).trim(); return s ? s.slice(0, max) : null; };

  if (tem("nome")) d.nome = txt(body.nome, 255);
  if (tem("email")) {
    d.email = txt(body.email, 255);
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { erro: "E-mail inválido" };
  }
  if (tem("telefone")) {
    const t = txt(body.telefone, 50);
    d.telefone = t ? (formatarTelefone(t) || null) : null;
    if (t && !d.telefone) return { erro: "Telefone inválido (use DDD + número)" };
  }
  if (tem("cpf")) {
    const c = String(body.cpf || "").replace(/\D/g, "");
    if (c && !validarCPF(c)) return { erro: "CPF inválido" };
    d.cpf = c || null;
  }
  if (tem("cnpj")) {
    const c = String(body.cnpj || "").replace(/\D/g, "");
    if (c && c.length !== 14) return { erro: "CNPJ inválido" };
    d.cnpj = c || null;
  }
  if (tem("data_nascimento")) {
    const dn = body.data_nascimento ? normalizarDataImport(body.data_nascimento) : null;
    if (body.data_nascimento && !dn) return { erro: "Data de nascimento inválida" };
    d.data_nascimento = dn;
  }
  if (tem("tipo_pessoa")) d.tipo_pessoa = String(body.tipo_pessoa).toUpperCase() === "PJ" ? "PJ" : "PF";
  if (tem("cep")) {
    const c = txt(body.cep, 10);
    d.cep = c ? (formatarCep(c) || null) : null;
    if (c && !d.cep) return { erro: "CEP inválido" };
  }
  if (tem("uf")) {
    const u = txt(body.uf, 2);
    if (u && !/^[A-Za-z]{2}$/.test(u)) return { erro: "UF inválida" };
    d.uf = u ? u.toUpperCase() : null;
  }
  for (const [k, max] of Object.entries(CAMPOS_TEXTO)) {
    if (k !== "cnpj" && tem(k)) d[k] = txt(body[k], max);
  }
  if (tem("observacoes")) d.observacoes = txt(body.observacoes, 5000);
  if (tem("status")) {
    if (!STATUS_VALIDOS.includes(body.status)) return { erro: "Status inválido" };
    d.status = body.status;
  }
  return { dados: d };
}

exports.listarLeads = async (req, res) => {
  try {
    const { status, q } = req.query;
    let query = "SELECT * FROM leads WHERE empresa_id = ?";
    const params = [req.empresa_id];

    if (status && status !== "todos") {
      query += " AND status = ?";
      params.push(status);
    }

    if (q) {
      query += " AND (nome LIKE ? OR email LIKE ? OR cpf LIKE ? OR cnpj LIKE ? OR telefone LIKE ? OR id_externo LIKE ?)";
      const search = `%${q}%`;
      params.push(search, search, search, search, search, search);
    }

    query += " ORDER BY criado_em DESC";

    // Paginacao opcional (sem limit = comportamento antigo, lista completa)
    const limit = Math.min(parseInt(req.query.limit, 10) || 0, 1000);
    if (limit > 0) {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      query += " LIMIT ? OFFSET ?";
      params.push(limit, (page - 1) * limit);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar leads:", err);
    res.status(500).json({ message: "Erro ao listar leads" });
  }
};

exports.criarLead = async (req, res) => {
  try {
    const body = req.body || {};
    const { dados, erro } = sanitizarCadastro(body);
    if (erro) return res.status(400).json({ message: erro });

    const faltando = camposFaltando(dados);
    if (faltando.length) return res.status(400).json({ message: mensagemFaltando(faltando), campos: faltando });

    if (dados.cpf && await verificarLeadExistente(dados.cpf, req.empresa_id)) {
      return res.status(409).json({ message: "Já existe um cadastro com este CPF" });
    }

    const mac = body.mac ? String(body.mac).slice(0, 50) : null;
    const ip = body.ip ? String(body.ip).slice(0, 50) : null;
    const colunas = ["empresa_id", "mac", "ip", "origem", "sistema_origem", "lgpd_aceite"];
    const valores = [req.empresa_id, mac, ip, body.origem ? String(body.origem).slice(0, 30) : "manual", "manual", body.lgpd_aceite ? 1 : 0];
    for (const [k, v] of Object.entries(dados)) { colunas.push(k); valores.push(v); }
    if (!dados.status) { colunas.push("status"); valores.push("novo"); }

    const [result] = await db.execute(
      `INSERT INTO leads (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`,
      valores
    );

    res.status(201).json({ id: result.insertId, message: "Cadastro criado com sucesso" });
  } catch (err) {
    console.error("Erro ao criar lead:", err);
    res.status(500).json({ message: "Erro ao criar lead" });
  }
};

exports.atualizarLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { dados, erro } = sanitizarCadastro(req.body || {});
    if (erro) return res.status(400).json({ message: erro });

    const chaves = Object.keys(dados);
    if (chaves.length === 0) {
      return res.status(400).json({ message: "Nenhum campo para atualizar" });
    }

    // Edicao do cadastro (nao so troca de status/observacoes): o resultado final precisa ter os obrigatorios
    if (chaves.some((k) => k !== "status" && k !== "observacoes")) {
      const [[atual]] = await db.execute(
        "SELECT nome, cpf, cnpj, tipo_pessoa, email, telefone, data_nascimento FROM leads WHERE id = ? AND empresa_id = ?",
        [id, req.empresa_id]
      );
      if (!atual) return res.status(404).json({ message: "Lead não encontrado" });
      const faltando = camposFaltando({ ...atual, ...dados });
      if (faltando.length) return res.status(400).json({ message: mensagemFaltando(faltando), campos: faltando });
    }

    if (dados.cpf) {
      const outro = await verificarLeadExistente(dados.cpf, req.empresa_id);
      if (outro && String(outro.id) !== String(id)) {
        return res.status(409).json({ message: "Já existe um cadastro com este CPF" });
      }
    }

    const [result] = await db.execute(
      `UPDATE leads SET ${chaves.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND empresa_id = ?`,
      [...chaves.map((k) => dados[k]), id, req.empresa_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Lead não encontrado" });
    }

    res.json({ message: "Lead atualizado com sucesso" });
  } catch (err) {
    console.error("Erro ao atualizar lead:", err);
    res.status(500).json({ message: "Erro ao atualizar lead" });
  }
};

exports.deletarLead = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.execute(
      "DELETE FROM leads WHERE id = ? AND empresa_id = ?",
      [id, req.empresa_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Lead não encontrado" });
    }

    res.json({ message: "Lead deletado com sucesso" });
  } catch (err) {
    console.error("Erro ao deletar lead:", err);
    res.status(500).json({ message: "Erro ao deletar lead" });
  }
};

exports.exportarLeadsCSV = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT nome, email, telefone, cpf, cnpj, tipo_pessoa, rg, razao_social, data_nascimento,
              cep, logradouro, numero, complemento, bairro, cidade, uf, id_externo, sistema_origem,
              mac, ip, status, origem, observacoes, lgpd_aceite, criado_em
       FROM leads WHERE empresa_id = ? ORDER BY criado_em DESC`,
      [req.empresa_id]
    );

    // Dados importados podem comecar com = + - @ : neutraliza formula ao abrir no Excel
    const cel = (v) => {
      let t = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return `"${t.replace(/"/g, '""')}"`;
    };
    // DATE do mysql2 vem como Date local: usa getters locais (toISOString poderia voltar um dia)
    const data = (d) => {
      if (!d) return "";
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };

    const header = "Nome,Email,Telefone,CPF,CNPJ,Tipo,RG,Razao Social,Nascimento,CEP,Logradouro,Numero,Complemento,Bairro,Cidade,UF,ID Externo,Sistema Origem,MAC,IP,Status,Origem,Observacoes,LGPD Aceite,Criado Em\n";
    const csvRows = rows.map(r => [
      cel(r.nome), cel(r.email), cel(r.telefone), cel(r.cpf), cel(r.cnpj), cel(r.tipo_pessoa), cel(r.rg),
      cel(r.razao_social), cel(data(r.data_nascimento)), cel(r.cep), cel(r.logradouro), cel(r.numero),
      cel(r.complemento), cel(r.bairro), cel(r.cidade), cel(r.uf), cel(r.id_externo), cel(r.sistema_origem),
      cel(r.mac), cel(r.ip), cel(r.status), cel(r.origem), cel(r.observacoes),
      r.lgpd_aceite ? "Sim" : "Não",
      cel(r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR') : ''),
    ].join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
    res.send("\uFEFF" + header + csvRows);
  } catch (err) {
    console.error("Erro ao exportar leads:", err);
    res.status(500).json({ message: "Erro ao exportar leads" });
  }
};

// Cadastro de cliente para portal Planos (pré-pagamento)
exports.cadastroCliente = async (req, res) => {
  try {
    const { nome, email, telefone, cpf, mac, ip, mikrotik_id, data_nascimento } = req.body;

    if (!nome || !email || !telefone || !cpf) {
      return res.status(400).json({ message: "Nome, email, telefone e CPF são obrigatórios" });
    }

    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }

    // Verificar CPF duplicado
    const existing = await verificarLeadExistente(cpf, empresaId);
    if (existing) {
      const cpfLimpo = cpf.replace(/\D/g, "");

      // Segundo fator: sem a data de nascimento correta nao ha reconexao, nem
      // alteracao do cadastro, nem retorno de nome/e-mail do titular.
      await gravarDataNascimento(cpfLimpo, empresaId, data_nascimento, { permitirLeadExistente: mesmoDispositivo(existing, mac) });
      const conf = await conferirDataNascimento(cpfLimpo, empresaId, data_nascimento, { mac, ip: req.ip, reivindicarAusente: true });
      if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
      if (conf === "divergente") {
        return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
      }
      if (conf === "reivindicado") {
        // CPF sem pagamento confirmado: cadastro provisorio. O contato (e o MAC) passa a ser o de
        // quem se cadastrou agora — assim a credencial do pagamento vai por WhatsApp para o telefone
        // de quem paga, nao para o de quem digitou o CPF antes (grilagem). Nada de credenciais
        // existentes nem dados do cadastro anterior na resposta.
        try {
          await atualizarLeadExistente(existing.id, empresaId, { nome, email, telefone, mac, ip });
        } catch (updErr) {
          console.warn("Aviso: falha ao atualizar lead reivindicado:", updErr.message);
        }
        return res.json({ id: existing.id, nome, email, existente: true, planoAtivo: false });
      }
      if (conf === "ausente") {
        // Cadastro legado sem data: nao da pra provar a titularidade. Segue para planos
        // sem devolver credenciais, sem trocar o contato e sem expor dados do titular.
        // Se o CPF ja tem acesso ativo em outro aparelho, nem chega nos planos: pagar
        // por ele trocaria a senha/fundiria o tempo do titular (ver bloqueiaPagamentoAlheio).
        if (await bloqueiaPagamentoAlheio({ cpf: cpfLimpo, mac, empresaId })) {
          return res.status(409).json({ message: MSG_PAGAMENTO_ALHEIO, requer_data_nascimento: true });
        }
        return res.json({ id: existing.id, nome, email, existente: true, planoAtivo: false });
      }

      // Atualiza os dados do lead existente com os novos valores do formulario.
      // Sem isso, o sistema sempre usaria o telefone/nome/email do PRIMEIRO cadastro
      // do CPF, mesmo o usuario tendo informado dados novos agora.
      // Preserva isolamento multi-tenant filtrando por empresa_id.
      try {
        await atualizarLeadExistente(existing.id, empresaId, { nome, email, telefone, mac, ip });
      } catch (updErr) {
        console.warn("Aviso: falha ao atualizar lead existente:", updErr.message);
      }

      // Verificar se tem saldo ativo no RADIUS (modelo cumulativo)
      try {
        const saldo = await verificarSaldoRadius(cpfLimpo);
        if (saldo.temSaldo) {
          // Buscar gateway do MikroTik
          let gateway = null;
          let mkId = null;
          if (empresaId) {
            const [[mk]] = await db.query(
              "SELECT id, end_hotspot, ip FROM mikrotiks WHERE empresa_id = ? LIMIT 1", [empresaId]
            );
            gateway = mk?.end_hotspot || mk?.ip || null;
            mkId = mk?.id || null;
          }

          return res.json({
            id: existing.id, nome: existing.nome, email: existing.email,
            existente: true, planoAtivo: true,
            gateway, username: cpfLimpo, password: saldo.password,
            tempoRestante: saldo.tempoRestante,
            gateway_info: await montarGatewayInfo({
              mikrotik_id: mkId, empresa_id: empresaId, mac, username: cpfLimpo,
            }),
          });
        }
      } catch (radErr) {
        console.error("Erro ao verificar RADIUS:", radErr.message);
      }

      // Sem plano ativo — segue para planos
      return res.json({ id: existing.id, nome: existing.nome, email: existing.email, existente: true, planoAtivo: false });
    }

    const cpfLimpo = cpf.replace(/\D/g, "");

    // AP/SSID onde o cliente esta conectado (contexto salvo no redirect)
    const apInfo = await resolverApDoContexto(mikrotik_id, mac);

    const [result] = await db.execute(
      `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, ap_mac, ssid, origem, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal_planos', 'novo')`,
      [empresaId, nome, email, telefone, cpfLimpo, mac || null, ip || null, apInfo.apMac, apInfo.ssid]
    );

    res.json({ id: result.insertId, nome, email, existente: false });
  } catch (err) {
    console.error("Erro ao cadastrar cliente:", err);
    res.status(500).json({ message: "Erro interno ao processar cadastro" });
  }
};
