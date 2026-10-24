const db = require("../../db");
const { gerarSenhaRadius } = require("../utils/radiusPassword");
const { verificarLeadExistente, gravarDataNascimento, mesmoDispositivo, verificarSaldoRadius, conferirDataNascimento, usernamePertenceAoLead, atualizarLeadExistente, resolverTextoLgpd } = require("../utils/leadUtils");
const { notificarLiberacao } = require("../services/whatsappNotify");
const { montarGatewayInfo } = require("../gateways/gatewayLiberacao");
const { resolverApDoContexto } = require("../utils/apInfo");

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
        // Username deste fluxo e' telefone/e-mail/MAC: so devolve credencial se for o do proprio lead
        const usernameDoLead = verificado && usernamePertenceAoLead(existing, username);
        // Cadastro legado sem data: registra so o novo aceite (nao troca contato/MAC de quem nao se provou)
        await atualizarLeadExistente(existing.id, empresaId, verificado
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
            gateway_info: await montarGatewayInfo({
              mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username,
            }),
          });
        }
        // Sem saldo: segue para re-liberacao abaixo.
      }
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
      query += " AND (nome LIKE ? OR email LIKE ? OR cpf LIKE ?)";
      const search = `%${q}%`;
      params.push(search, search, search);
    }

    query += " ORDER BY criado_em DESC";

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar leads:", err);
    res.status(500).json({ message: "Erro ao listar leads" });
  }
};

exports.criarLead = async (req, res) => {
  try {
    const { nome, email, telefone, cpf, mac, ip, status, origem, observacoes, lgpd_aceite } = req.body;

    const [result] = await db.execute(
      `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, status, origem, observacoes, lgpd_aceite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.empresa_id,
        nome || null,
        email || null,
        telefone || null,
        cpf || null,
        mac || null,
        ip || null,
        status || "novo",
        origem || "manual",
        observacoes || null,
        lgpd_aceite ? 1 : 0
      ]
    );

    res.status(201).json({ id: result.insertId, message: "Lead criado com sucesso" });
  } catch (err) {
    console.error("Erro ao criar lead:", err);
    res.status(500).json({ message: "Erro ao criar lead" });
  }
};

exports.atualizarLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, telefone, cpf, status, observacoes } = req.body;

    const fields = [];
    const params = [];

    if (nome !== undefined) { fields.push("nome = ?"); params.push(nome); }
    if (email !== undefined) { fields.push("email = ?"); params.push(email); }
    if (telefone !== undefined) { fields.push("telefone = ?"); params.push(telefone); }
    if (cpf !== undefined) { fields.push("cpf = ?"); params.push(cpf); }
    if (status !== undefined) { fields.push("status = ?"); params.push(status); }
    if (observacoes !== undefined) { fields.push("observacoes = ?"); params.push(observacoes); }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Nenhum campo para atualizar" });
    }

    params.push(id, req.empresa_id);

    const [result] = await db.execute(
      `UPDATE leads SET ${fields.join(", ")} WHERE id = ? AND empresa_id = ?`,
      params
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
      "SELECT nome, email, telefone, cpf, mac, ip, status, origem, observacoes, lgpd_aceite, criado_em FROM leads WHERE empresa_id = ? ORDER BY criado_em DESC",
      [req.empresa_id]
    );

    const header = "Nome,Email,Telefone,CPF,MAC,IP,Status,Origem,Observacoes,LGPD Aceite,Criado Em\n";
    const csvRows = rows.map(r => {
      return [
        `"${(r.nome || '').replace(/"/g, '""')}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        `"${(r.telefone || '').replace(/"/g, '""')}"`,
        `"${(r.cpf || '').replace(/"/g, '""')}"`,
        `"${(r.mac || '').replace(/"/g, '""')}"`,
        `"${(r.ip || '').replace(/"/g, '""')}"`,
        `"${r.status}"`,
        `"${r.origem}"`,
        `"${(r.observacoes || '').replace(/"/g, '""')}"`,
        r.lgpd_aceite ? "Sim" : "Não",
        `"${r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR') : ''}"`
      ].join(",");
    }).join("\n");

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
      const conf = await conferirDataNascimento(cpfLimpo, empresaId, data_nascimento, { mac, ip: req.ip });
      if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
      if (conf === "divergente") {
        return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
      }
      if (conf === "ausente") {
        // Cadastro legado sem data: nao da pra provar a titularidade. Segue para planos
        // sem devolver credenciais, sem trocar o contato e sem expor dados do titular.
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
