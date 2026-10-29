const db = require("../../db");
const { gerarSenhaRadius } = require("../utils/radiusPassword");
const { verificarLeadExistente, buscarCadastroPorCpf, gravarDataNascimento, mesmoDispositivo, verificarSaldoRadius, conferirDataNascimento, podeReceberCredenciais, bloqueiaReliberacao, MSG_ACESSO_ATIVO, atualizarLeadExistente, gravarEquipamentoLead, resolverTextoLgpd, resolverCamposPortal } = require("../utils/leadUtils");
const { validarCampos } = require("../utils/camposPortal");
const { validarCPF } = require("../utils/cpf");
const { normalizarDataNascimento } = require("../utils/dataNascimento");
const { mascararNome } = require("../utils/mascararDados");
const { notificarLiberacao } = require("../services/whatsappNotify");
const { montarGatewayInfo } = require("../gateways/gatewayLiberacao");
const { resolverApDoContexto } = require("../utils/apInfo");
const { tratarSessaoAtiva } = require("../utils/sessaoAtiva");
const { normalizarMac } = require("../utils/entradaSegura");
const { temColuna } = require("../utils/schemaCache");

exports.lgpdLogin = async (req, res) => {
  try {
    const { cpf, aceite, mac, ip, email, nome, telefone, mikrotik_id, data_nascimento } = req.body;

    if (aceite === undefined || !mac || !ip) {
      return res.status(400).json({ message: "Dados obrigatórios faltando" });
    }

    // CPF digitado no portal e' validado no servidor (digitos verificadores): a validacao do front
    // e' contornavel e CPF inventado vira cadastro/username RADIUS que ninguem pode reclamar.
    if (cpf && !validarCPF(cpf)) return res.status(400).json({ message: "CPF inválido" });

    // Resolver empresa_id via mikrotik_id (endpoint público)
    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }

    // Campos obrigatorios configurados no Editor do portal (vale tambem no servidor)
    const erroCampos = validarCampos(await resolverCamposPortal({ mikrotikId: mikrotik_id, empresaId, tipoPortal: "lgpd" }), { nome, email, telefone });
    if (erroCampos) return res.status(400).json({ message: erroCampos });

    const aceiteInt = aceite ? 1 : 0;
    // Limpar caracteres especiais do CPF para usar como username RADIUS
    const cpfLimpo = cpf ? cpf.replace(/\D/g, '') : null;
    const username = cpfLimpo || mac;
    const senha = gerarSenhaRadius(); // aleatoria; devolvida ao frontend/WhatsApp

    // Busca plano LGPD da empresa ANTES de inserir registros
    let planoQuery = `
      SELECT p.id, p.duracao_minutos, p.velocidade_down, p.velocidade_up, p.mikrotik_id, p.shared_users, m.end_hotspot
      FROM planos p
      JOIN mikrotiks m ON p.mikrotik_id = m.id
      WHERE p.nome = 'LGPD'`;
    const planoParams = [];

    if (empresaId) {
      planoQuery += ` AND p.empresa_id = ?`;
      planoParams.push(empresaId);
    }

    planoQuery += ` LIMIT 1`;
    const [[plano]] = await db.query(planoQuery, planoParams);

    if (!plano) {
      return res.status(404).json({ message: "Plano LGPD não configurado" });
    }

    // Reconexao por CPF: se ja existe, NAO bloqueia. Atualiza o lead (novo aceite
    // LGPD com timestamp valido) e, se ainda ha saldo, devolve credenciais pra
    // reconectar. Se esgotou, segue o fluxo normal (re-liberacao) sem duplicar lead.
    // Snapshot do termo exibido no portal (prova LGPD de qual texto foi aceito)
    const termoLgpd = await resolverTextoLgpd({ mikrotikId: mikrotik_id, empresaId, tipoPortal: "lgpd" });

    // AP/SSID onde o cliente esta conectado (contexto salvo no redirect)
    const apInfo = await resolverApDoContexto(mikrotik_id, mac);

    let leadJaRegistrado = false;
    let titularVerificado = false;
    if (cpf) {
      const existing = await verificarLeadExistente(cpfLimpo, empresaId);
      if (existing) {
        leadJaRegistrado = true;
        // Segundo fator: sem a data de nascimento correta nao ha reconexao nem
        // alteracao do cadastro (o CPF sozinho e' publico/adivinhavel).
        await gravarDataNascimento(cpfLimpo, empresaId, data_nascimento, { permitirLeadExistente: mesmoDispositivo(existing, mac) });
        const conf = await conferirDataNascimento(cpfLimpo, empresaId, data_nascimento, { mac, ip: req.ip });
        if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
        if (conf === "divergente") {
          return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
        }
        const dataOk = conf === "ok";
        // 'reivindicado' = CPF sem pagamento confirmado, cadastro provisorio: o contato passa a ser
        // o de quem se cadastrou agora, mas NAO prova titularidade (nada de credenciais existentes).
        const reivindicado = conf === "reivindicado";
        // Em CPF sem pagamento a data nao prova nada (quem reivindica a grava e volta com ela):
        // as credenciais de um acesso existente so voltam para o aparelho que ja o usou.
        const verificado = dataOk && await podeReceberCredenciais({ cpf: cpfLimpo, username, mac, empresaId });
        titularVerificado = verificado;
        // Cadastro legado sem data: registra so o novo aceite (nao troca contato/MAC de quem nao se provou)
        await atualizarLeadExistente(existing.id, empresaId, (dataOk || reivindicado)
          ? { nome, email, telefone, mac, ip, aceite: aceiteInt, termo: termoLgpd, ap_mac: apInfo.apMac, ssid: apInfo.ssid }
          : { aceite: aceiteInt, termo: termoLgpd });

        const saldo = verificado ? await verificarSaldoRadius(username) : { temSaldo: false };
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
            // (titular verificado: a sessao velha do MESMO aparelho e' derrubada sozinha)
            ...(await tratarSessaoAtiva({ username, mac, empresaId, autorizado: true })),
            gateway_info: await montarGatewayInfo({
              mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username,
            }),
          });
        }
        // Sem saldo: segue para re-liberacao abaixo.
      }
    }

    // Re-liberar troca senha e plano do username: recusa se ele ja tem acesso ativo e o
    // titular nao foi verificado (cadastro legado sem data, ou CPF ainda sem lead).
    if (await bloqueiaReliberacao({ username, titularVerificado, usernameEhMac: !cpfLimpo })) {
      return res.status(409).json({ message: MSG_ACESSO_ATIVO, requer_data_nascimento: true });
    }

    // Salvar na tabela unificada leads (origem = 'lgpd') — apenas se novo CPF
    if (!leadJaRegistrado) {
      await db.execute(
        `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, ap_mac, ssid, origem, lgpd_aceite, lgpd_aceite_em, lgpd_termo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lgpd', ?, NOW(), ?)`,
        [empresaId, nome || null, email || null, telefone || null, cpf || null, mac, ip, apInfo.apMac, apInfo.ssid, aceiteInt, termoLgpd]
      );
      await gravarDataNascimento(cpfLimpo, empresaId, data_nascimento);
    }
    await gravarEquipamentoLead(empresaId, { cpf: cpfLimpo || null, mac }, mikrotik_id);

    // Remove autenticações antigas
    await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
    await db.query("DELETE FROM radreply WHERE username = ?", [username]);
    await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);

    // Reseta o contador total via timestamp (sqlcounter soma radacct com
    // acctstarttime >= liberado_em). Historico do radacct preservado (Marco Civil).
    await db.query(`UPDATE radius_users SET liberado_em = NOW() WHERE username = ?`, [username]);

    const rateLimit = `${plano.velocidade_up}M/${plano.velocidade_down}M`;
    const tempoSegundos = plano.duracao_minutos * 60;

    // Cria autenticacao no RADIUS: senha + limite TOTAL acumulado + 1 sessao unica.
    // Max-All-Session e' consumido pelo sqlcounter 'totalcounter' (reset=never).
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Cleartext-Password', ':=', ?),
              (?, 'Max-All-Session', ':=', ?),
              (?, 'Simultaneous-Use', ':=', '1')`,
      [username, senha, username, String(tempoSegundos), username]
    );

    // WISPr-Bandwidth-Max-*: cap em bps pra vendors nao-MikroTik (Omada/UniFi
    // honram no Access-Accept); o MikroTik ignora e usa o Mikrotik-Rate-Limit.
    const [wUpM, wDownM] = String(rateLimit).split("/").map((v) => parseFloat(v) || 0);
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value)
       VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?),
              (?, 'Session-Timeout', ':=', ?),
              (?, 'WISPr-Bandwidth-Max-Up', ':=', ?),
              (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [username, rateLimit, username, tempoSegundos,
       username, String(Math.round(wUpM * 1000000)), username, String(Math.round(wDownM * 1000000))]
    );

    await db.query(
      "INSERT INTO radusergroup (username, groupname) VALUES (?, ?)",
      [username, plano.id]
    );

    await db.query(
      `INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), nas_id = VALUES(nas_id), empresa_id = VALUES(empresa_id), liberado_em = NOW()`,
      [empresaId, username, plano.id, plano.mikrotik_id]
    );

    const gateway = plano.end_hotspot || ip;
    const loginUrl = gateway ? `http://${gateway}/login?username=${username}&password=${senha}` : "";

    // Resolver portal_id LGPD da empresa para notificacao WhatsApp
    let portalId = null;
    if (empresaId) {
      try {
        const [[portalLgpd]] = await db.execute(
          "SELECT id FROM portais WHERE tipo = 'lgpd' AND empresa_id = ? LIMIT 1",
          [empresaId]
        );
        portalId = portalLgpd?.id || null;
      } catch (_) {}
    }

    notificarLiberacao({
      empresa_id: empresaId,
      portal_id: portalId,
      mikrotik_id: plano.mikrotik_id,
      telefone: telefone || null,
      cpf: cpfLimpo || null,
      mac,
      contexto_tipo: "lgpd",
      vars: {
        nome: nome || null,
        username,
        password: senha,
        plano: "LGPD",
        duracao: plano.duracao_minutos,
        velocidade: `${plano.velocidade_down}M/${plano.velocidade_up}M`,
        login_url: loginUrl,
        cpf: cpfLimpo || "",
      },
    }).catch(err => console.warn("[lgpdLogin] notificarLiberacao falhou:", err.message));

    return res.json({
      success: true, gateway, username, password: senha,
      // Re-liberacao com sessao aberta em OUTRO aparelho (Simultaneous-Use=1 recusaria o login novo):
      // o portal oferece "desconectar a anterior e conectar aqui", como na reconexao com saldo.
      ...(await tratarSessaoAtiva({ username, mac, empresaId })),
      gateway_info: await montarGatewayInfo({
        mikrotik_id: plano.mikrotik_id, empresa_id: empresaId, mac, username,
        duracaoSegundos: tempoSegundos,
      }),
    });
  } catch (err) {
    console.error("Erro LGPD Login:", err);
    return res.status(500).json({ message: "Erro interno ao processar login LGPD" });
  }
};

// Relatorio de consentimentos: inclui TODO aceite LGPD registrado, independente
// do portal de origem (lgpd, portal_lead, planos...) — nao so origem='lgpd'.
const LGPD_WHERE = "l.empresa_id = ? AND (l.origem = 'lgpd' OR l.lgpd_aceite = 1)";

const DATA_EXPR = "COALESCE(l.lgpd_aceite_em, l.criado_em)";

// Filtros opcionais da tela/CSV. Sempre empresa_id do tenant; valores validados e passados como placeholders.
// Equipamento do aceite (leads.mikrotik_id, migration 056): so entra na consulta se a coluna existe.
const COLS_EQUIP = (tem) => (tem ? "l.mikrotik_id, m.nome AS equipamento_nome" : "NULL AS mikrotik_id, NULL AS equipamento_nome");
const JOIN_EQUIP = (tem) => (tem ? "LEFT JOIN mikrotiks m ON m.id = l.mikrotik_id AND m.empresa_id = l.empresa_id" : "");

function montarFiltrosLgpd(query, empresaId, { comEquipamento = true } = {}) {
  const q = query || {};
  const invalido = () => { const e = new Error("Filtro inválido"); e.status = 400; return e; };
  const txt = (v) => {
    if (v == null) return "";
    if (typeof v !== "string") throw invalido();
    return v.trim();
  };
  let where = LGPD_WHERE;
  const params = [empresaId];
  const dia = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw invalido();
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw invalido();
    return d;
  };

  const origem = txt(q.origem);
  if (origem) {
    if (!/^[a-z_]{1,30}$/.test(origem)) throw invalido();
    where += " AND l.origem = ?"; params.push(origem);
  }
  const aceite = txt(q.aceite);
  if (aceite) {
    if (aceite !== "0" && aceite !== "1") throw invalido();
    where += " AND l.lgpd_aceite = ?"; params.push(Number(aceite));
  }
  const de = txt(q.de);
  const ate = txt(q.ate);
  const dDe = de ? dia(de) : null;
  const dAte = ate ? dia(ate) : null;
  if (dDe && dAte && (dDe > dAte || (dAte - dDe) / 86400000 > 366)) throw invalido();
  if (dDe) { where += ` AND ${DATA_EXPR} >= ?`; params.push(`${de} 00:00:00`); }
  if (dAte) { where += ` AND ${DATA_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)`; params.push(`${ate} 00:00:00`); }
  const ap = txt(q.ap);
  if (ap) {
    const mac = normalizarMac(ap);
    if (!mac) throw invalido();
    where += " AND l.ap_mac = ?"; params.push(mac);
  }
  const equip = txt(q.equipamento);
  if (equip) {
    if (!/^\d{1,10}$/.test(equip) || Number(equip) <= 0) throw invalido();
    if (comEquipamento) { where += " AND l.mikrotik_id = ?"; params.push(Number(equip)); }
  }
  const ssid = txt(q.ssid);
  if (ssid) {
    if (ssid.length > 64) throw invalido();
    where += " AND l.ssid = ?"; params.push(ssid);
  }
  return { where, params };
}
exports.montarFiltrosLgpd = montarFiltrosLgpd;

exports.getAllLgpd = async (req, res) => {
  try {
    const temEq = await temColuna("leads", "mikrotik_id");
    const { where, params } = montarFiltrosLgpd(req.query, req.empresa_id, { comEquipamento: temEq });
    const [rows] = await db.query(
      `SELECT l.id, l.cpf, l.email, l.nome, l.telefone, l.mac, l.ip, l.origem,
              l.ap_mac, l.ssid, ap.nome AS ap_nome, ${COLS_EQUIP(temEq)},
              l.lgpd_aceite as aceite, l.lgpd_aceite_em, l.lgpd_termo, l.criado_em
       FROM leads l
       LEFT JOIN access_points ap
         ON ap.mac = l.ap_mac AND ap.empresa_id = l.empresa_id
       ${JOIN_EQUIP(temEq)}
       WHERE ${where}
       ORDER BY ${DATA_EXPR} DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    console.error("Erro ao buscar cadastros LGPD:", err);
    res.status(500).json({ message: "Erro ao buscar dados LGPD" });
  }
};

// Valores para popular os filtros da tela (origens, redes e pontos de acesso da empresa).
exports.getFiltrosLgpd = async (req, res) => {
  try {
    const [origens] = await db.query(`SELECT DISTINCT l.origem FROM leads l WHERE ${LGPD_WHERE} AND l.origem IS NOT NULL AND l.origem <> '' ORDER BY l.origem`, [req.empresa_id]);
    const [ssids] = await db.query(`SELECT DISTINCT l.ssid FROM leads l WHERE ${LGPD_WHERE} AND l.ssid IS NOT NULL AND l.ssid <> '' ORDER BY l.ssid`, [req.empresa_id]);
    const [aps] = await db.query(
      `SELECT DISTINCT l.ap_mac, ap.nome AS ap_nome FROM leads l
       LEFT JOIN access_points ap ON ap.mac = l.ap_mac AND ap.empresa_id = l.empresa_id
       WHERE ${LGPD_WHERE} AND l.ap_mac IS NOT NULL AND l.ap_mac <> '' ORDER BY ap.nome, l.ap_mac`,
      [req.empresa_id]
    );
    let equipamentos = [];
    if (await temColuna("leads", "mikrotik_id")) {
      [equipamentos] = await db.query(
        `SELECT DISTINCT m.id, m.nome FROM leads l
         JOIN mikrotiks m ON m.id = l.mikrotik_id AND m.empresa_id = l.empresa_id
         WHERE ${LGPD_WHERE} ORDER BY m.nome`,
        [req.empresa_id]
      );
    }
    res.json({ origens: origens.map((r) => r.origem), ssids: ssids.map((r) => r.ssid), aps, equipamentos });
  } catch (err) {
    console.error("Erro ao buscar filtros LGPD:", err);
    res.status(500).json({ message: "Erro ao buscar filtros" });
  }
};

// Export CSV do relatorio de consentimentos (prova LGPD: quem, quando, de onde
// e QUAL termo foi aceito). Usado com token curto de download (verifyDownloadToken).
exports.exportarLgpdCSV = async (req, res) => {
  try {
    const temEq = await temColuna("leads", "mikrotik_id");
    const { where, params } = montarFiltrosLgpd(req.query, req.empresa_id, { comEquipamento: temEq });
    const [rows] = await db.query(
      `SELECT l.nome, l.email, l.telefone, l.cpf, l.mac, l.ip, l.origem,
              l.ap_mac, l.ssid, ap.nome AS ap_nome, ${COLS_EQUIP(temEq)},
              l.lgpd_aceite, l.lgpd_aceite_em, l.lgpd_termo, l.criado_em
       FROM leads l
       LEFT JOIN access_points ap
         ON ap.mac = l.ap_mac AND ap.empresa_id = l.empresa_id
       ${JOIN_EQUIP(temEq)}
       WHERE ${where}
       ORDER BY ${DATA_EXPR} DESC
       LIMIT 50000`,
      params
    );

    const fmtData = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) : "");
    const header = "Nome,Email,Telefone,CPF,MAC,IP,Equipamento,AP MAC,AP Nome,SSID,Origem,Aceite,Aceite Em,Cadastro Em,Termo Aceito";
    const csvRows = rows.map((r) =>
      [
        r.nome || "",
        r.email || "",
        r.telefone || "",
        r.cpf || "",
        r.mac || "",
        r.ip || "",
        r.equipamento_nome || "",
        r.ap_mac || "",
        r.ap_nome || "",
        r.ssid || "",
        r.origem || "",
        r.lgpd_aceite ? "Sim" : "Nao",
        fmtData(r.lgpd_aceite_em),
        fmtData(r.criado_em),
        r.lgpd_termo || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = [header, ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=consentimentos_lgpd.csv");
    res.send(csv);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    console.error("Erro ao exportar CSV LGPD:", err);
    res.status(500).json({ message: "Erro ao exportar CSV." });
  }
};

exports.lgpdCadastro = async (req, res) => {
  try {
    const { cpf, aceite, mac, ip, nome, telefone, email, mikrotik_id, data_nascimento } = req.body;

    if (!cpf || aceite === undefined) {
      return res.status(400).json({ message: "CPF e aceite são obrigatórios" });
    }
    if (!validarCPF(cpf)) return res.status(400).json({ message: "CPF inválido" });

    let empresaId = null;
    if (mikrotik_id) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mikrotik_id]);
      empresaId = mtk?.empresa_id || null;
    }

    // Campos obrigatorios configurados no Editor do portal (vale tambem no servidor)
    const erroCampos = validarCampos(await resolverCamposPortal({ mikrotikId: mikrotik_id, empresaId, tipoPortal: "lgpd" }), { nome, email, telefone });
    if (erroCampos) return res.status(400).json({ message: erroCampos });

    const aceiteInt = aceite ? 1 : 0;

    // Snapshot do termo exibido no portal (prova LGPD de qual texto foi aceito)
    const termoLgpd = await resolverTextoLgpd({ mikrotikId: mikrotik_id, empresaId, tipoPortal: "lgpd" });

    // AP/SSID onde o cliente esta conectado (contexto salvo no redirect)
    const apInfo = await resolverApDoContexto(mikrotik_id, mac);

    // Reconexao por CPF: se ja existe, re-registra o consentimento (novo aceite
    // LGPD com timestamp valido) em vez de bloquear.
    let leadJaRegistrado = false;
    let permitirDataEmExistente = false;
    if (cpf) {
      const cpfCheck = cpf.replace(/\D/g, "");
      const existing = await verificarLeadExistente(cpfCheck, empresaId);
      if (existing) {
        leadJaRegistrado = true;
        // Lead antigo sem data: so preenche se for o mesmo aparelho do cadastro anterior
        permitirDataEmExistente = mesmoDispositivo(existing, mac);
        // Mesmo segundo fator do lgpdLogin: o CPF sozinho e' publico, entao sem a data correta (ou sem
        // ser cadastro provisorio) o contato/MAC do cadastro existente nao e' trocado.
        await gravarDataNascimento(cpfCheck, empresaId, data_nascimento, { permitirLeadExistente: permitirDataEmExistente });
        const conf = await conferirDataNascimento(cpfCheck, empresaId, data_nascimento, { mac, ip: req.ip });
        if (conf === "bloqueado") return res.status(429).json({ message: "Muitas tentativas. Tente novamente mais tarde." });
        if (conf === "divergente") {
          return res.status(403).json({ message: "Data de nascimento não confere com o cadastro deste CPF.", requer_data_nascimento: true });
        }
        await atualizarLeadExistente(existing.id, empresaId, (conf === "ok" || conf === "reivindicado")
          ? { nome, email, telefone, mac, ip, aceite: aceiteInt, termo: termoLgpd, ap_mac: apInfo.apMac, ssid: apInfo.ssid }
          : { aceite: aceiteInt, termo: termoLgpd });
      }
    }

    if (!leadJaRegistrado) {
      await db.execute(
        `INSERT INTO leads (empresa_id, nome, email, telefone, cpf, mac, ip, ap_mac, ssid, origem, lgpd_aceite, lgpd_aceite_em, lgpd_termo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lgpd', ?, NOW(), ?)`,
        [empresaId, nome || null, email || null, telefone || null, cpf, mac || null, ip || null, apInfo.apMac, apInfo.ssid, aceiteInt, termoLgpd]
      );
    }
    await gravarDataNascimento(cpf, empresaId, data_nascimento, { permitirLeadExistente: permitirDataEmExistente });
    await gravarEquipamentoLead(empresaId, { cpf }, mikrotik_id);

    res.json({ success: true, message: "Cadastro LGPD realizado com sucesso" });
  } catch (err) {
    console.error("Erro ao cadastrar LGPD:", err);
    res.status(500).json({ message: "Erro interno ao cadastrar LGPD" });
  }
};

/**
 * POST /api/lgpd/consulta-cpf (publico) — preenche o cadastro a partir do proprio banco.
 * Corpo: { cpf, data_nascimento, mikrotik_id, confirmar }.
 * So acha se CPF + data de nascimento baterem com um cadastro da MESMA empresa.
 * "Nao encontrado" e' sempre a mesma resposta (CPF inexistente, data diferente, cadastro
 * antigo sem data): nao da pra descobrir quais CPFs existem. Passo 1 devolve o nome
 * mascarado; com confirmar=true devolve nome e telefone. Nunca loga CPF, nome ou data.
 */
exports.consultaCpf = async (req, res) => {
  try {
    const { cpf, data_nascimento, mikrotik_id, confirmar } = req.body || {};
    const dataIso = normalizarDataNascimento(data_nascimento);
    if (typeof cpf !== "string" || !validarCPF(cpf) || !dataIso) {
      return res.status(400).json({ message: "Informe um CPF e uma data de nascimento válidos" });
    }

    let empresaId = null;
    const mtkId = Number(mikrotik_id);
    if (Number.isInteger(mtkId) && mtkId > 0) {
      const [[mtk]] = await db.execute("SELECT empresa_id FROM mikrotiks WHERE id = ?", [mtkId]);
      empresaId = mtk?.empresa_id || null;
    }

    let cadastro = null;
    if (empresaId) {
      try {
        cadastro = await buscarCadastroPorCpf(cpf, dataIso, empresaId);
      } catch (err) {
        // Ex.: migration 026 ainda nao rodou. Nao revela nada ao cliente.
        console.warn("[consulta-cpf] busca indisponivel:", err.message);
      }
    }
    console.log(`[consulta-cpf] empresa=${empresaId || "-"} resultado=${cadastro ? "achou" : "nao-achou"} ip=${req.ip}`);

    if (!cadastro) return res.json({ encontrado: false });
    if (res.locals) res.locals.consultaEncontrada = true; // acertou a data: nao consome as travas por CPF/dispositivo
    if (confirmar === true) {
      return res.json({ encontrado: true, nome: cadastro.nome, telefone: cadastro.telefone || "", email: cadastro.email || "" });
    }
    return res.json({ encontrado: true, nome_mascarado: mascararNome(cadastro.nome) });
  } catch (err) {
    console.error("Erro na consulta de CPF:", err.message);
    res.status(500).json({ message: "Erro interno na consulta" });
  }
};
