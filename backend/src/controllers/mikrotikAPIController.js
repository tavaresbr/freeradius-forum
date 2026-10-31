const db = require("../../db");
const { RouterOSAPI } = require("node-routeros");
require("../utils/routerosPatch"); // !empty do RouterOS 7 (ver utils/routerosPatch.js)
const axios = require("axios");
const { notificarLiberacao } = require("../services/whatsappNotify");
const { upgradeSessaoCoA } = require("../utils/coa");
const { gerarSenhaRadius, ehSenhaLegada } = require("../utils/radiusPassword");
const { verificarSaldoRadius } = require("../utils/leadUtils");

async function obterInformacoes(req, res) {
  const { id } = req.params;

  try {
    const [[mikrotik]] = await db.execute("SELECT * FROM mikrotiks WHERE id = ? AND empresa_id = ?", [id, req.empresa_id]);
    if (!mikrotik) return res.status(404).json({ message: "Mikrotik não encontrado" });

    const conn = new RouterOSAPI({
      host: mikrotik.ip,
      user: mikrotik.usuario,
      password: mikrotik.senha,
      port: mikrotik.porta || 8728,
      keepalive: false,
      timeout: 5000,
    });

    await conn.connect();

    const [resource] = await conn.write("/system/resource/print");
    await conn.close();

    return res.json({
      modelo: resource["board-name"] || "Desconhecido",
      versao: resource.version || "N/A",
      uptime: resource.uptime || "N/A",
      cpu: resource["cpu"] || "N/A",
    });
  } catch (err) {
    console.error("Erro ao obter informações do Mikrotik:", err.message);
    return res.status(500).json({ message: "Falha na conexão com o Mikrotik" });
  }
}

/**
 * Quando a liberacao empilhou tempo restante, o vencimento dos pagamentos aprovados do
 * mesmo cliente precisa acompanhar o total: o job de expiracao remove o usuario do RADIUS
 * no `expira_em` de cada pagamento (e o de um pagamento antigo derrubaria o tempo novo).
 * So avanca o vencimento (nunca encurta). Nao bloqueia a liberacao.
 */
async function estenderExpiracaoPagamentos({ empresaId, cpfNumeros, mac, totalSegundos }) {
  try {
    const porCpf = !!cpfNumeros;
    await db.query(
      `UPDATE pagamentos
          SET expira_em = DATE_ADD(NOW(), INTERVAL ? SECOND)
        WHERE empresa_id = ? AND status = 'approved'
          AND ${porCpf ? "REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ?" : "mac = ?"}
          AND (expira_em IS NULL OR expira_em < DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [totalSegundos, empresaId, porCpf ? cpfNumeros : mac, totalSegundos]
    );
  } catch (err) {
    console.warn("[liberarUsuario] estender expiracao dos pagamentos falhou:", err.message);
  }
}

/**
 * Libera usuário no RADIUS com todos os atributos.
 * @param {Object} params
 * @param {string} params.mac - MAC address
 * @param {string} params.ip - IP address
 * @param {string} params.plano - Nome do plano
 * @param {number} [params.empresa_id] - ID da empresa (obrigatório para multi-tenant)
 * @param {number} [params.shared_users] - Limite de sessões simultâneas
 * @param {boolean} [params.empilharTempo=false] - Soma o tempo restante do acesso ativo ao do plano novo
 *   (em vez de descarta-lo). SO para caminhos com idempotencia por pagamento (`pagamentos.liberado_em`):
 *   uma 2a chamada para o mesmo pagamento empilharia o plano de novo.
 */
async function liberarUsuario({ mac, ip, plano, empresa_id, cpf, telefone, cliente_id, portal_id, contexto_tipo, referencia_id, empilharTempo = false }) {
  try {
    // Username/senha: CPF (se tiver) ou MAC. Nao bloqueia por falta de CPF
    // (portais de Leads e Leads sem internet podem nao ter CPF).
    const cpfNumeros = cpf ? String(cpf).replace(/\D/g, "") : null;
    const username = cpfNumeros || mac;
    // Senha ALEATORIA (nao mais == username). A senha real gravada em radcheck e'
    // a devolvida ao chamador / WhatsApp. Definida no ramo CoA ou no fluxo normal.
    let senha = null;

    // Consulta plano FILTRANDO POR EMPRESA
    let planoQuery = "SELECT * FROM planos WHERE nome = ?";
    const planoParams = [plano];
    if (empresa_id) {
      planoQuery += " AND empresa_id = ?";
      planoParams.push(empresa_id);
    }
    planoQuery += " LIMIT 1";

    const [planos] = await db.query(planoQuery, planoParams);
    const p = planos[0];
    if (!p) throw new Error(`Plano '${plano}' não encontrado${empresa_id ? ` para empresa ${empresa_id}` : ''}`);

    const rateLimit = `${p.velocidade_up}M/${p.velocidade_down}M`;
    // Pagamento com acesso ainda ativo: o tempo restante nao se perde, soma ao do plano novo
    // (a velocidade passa a ser a do plano novo). liberado_em = NOW() zera o contador, entao o
    // limite novo ja carrega o saldo antigo.
    let tempoRestante = 0;
    if (empilharTempo) {
      const saldoAtual = await verificarSaldoRadius(username);
      if (saldoAtual.existe && saldoAtual.temSaldo) tempoRestante = Math.max(0, Math.floor(saldoAtual.tempoRestante));
    }
    const tempoSegundos = p.duracao_minutos * 60 + tempoRestante;
    const empresaIdFinal = empresa_id || p.empresa_id;

    // 1.7: Upgrade SEM reconexao. Se ja existe sessao ativa com este username
    // (ex.: trial criado com o CPF), atualiza os atributos e envia CoA pra sessao
    // ativa em vez de recriar/derrubar. So cai no fluxo de recriacao (reconexao)
    // se o CoA falhar.
    const [sessAtiva] = await db.query(
      "SELECT 1 FROM radacct WHERE username = ? AND acctstoptime IS NULL LIMIT 1",
      [username]
    );
    if (sessAtiva.length > 0) {
      try {
        // Senha: mantem a do trial/ciclo atual (o navegador do cliente ja a recebeu e
        // a sessao esta ativa). Se ausente ou legada (== username), grava uma nova.
        const [pwRow] = await db.query(
          "SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1",
          [username]
        );
        if (pwRow.length > 0 && !ehSenhaLegada(username, pwRow[0].value)) {
          senha = String(pwRow[0].value);
        } else {
          senha = gerarSenhaRadius();
          if (pwRow.length > 0) {
            await db.query("UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'", [senha, username]);
          } else {
            await db.query("INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)", [username, senha]);
          }
        }

        // Garante Max-All-Session (trial nao tinha esse atributo)
        const [chkMax] = await db.query(
          "SELECT id FROM radcheck WHERE username = ? AND attribute = 'Max-All-Session' LIMIT 1",
          [username]
        );
        if (chkMax.length > 0) {
          await db.query("UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Max-All-Session'", [String(tempoSegundos), username]);
        } else {
          await db.query("INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Max-All-Session', ':=', ?)", [username, String(tempoSegundos)]);
        }
        await db.query("UPDATE radcheck SET value = '1' WHERE username = ? AND attribute = 'Simultaneous-Use'", [username]);

        // Atualiza (ou cria) banda e timeout no radreply
        // WISPr-Bandwidth-Max-*: cap em bps pra vendors nao-MikroTik (Omada/UniFi)
        const [wisprUpM, wisprDownM] = String(rateLimit).split("/").map((v) => parseFloat(v) || 0);
        for (const [attr, val] of [
          ["Mikrotik-Rate-Limit", rateLimit],
          ["Session-Timeout", String(tempoSegundos)],
          ["WISPr-Bandwidth-Max-Up", String(Math.round(wisprUpM * 1000000))],
          ["WISPr-Bandwidth-Max-Down", String(Math.round(wisprDownM * 1000000))],
        ]) {
          const [ex] = await db.query("SELECT id FROM radreply WHERE username = ? AND attribute = ? LIMIT 1", [username, attr]);
          if (ex.length > 0) {
            await db.query("UPDATE radreply SET value = ? WHERE username = ? AND attribute = ?", [val, username, attr]);
          } else {
            await db.query("INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ':=', ?)", [username, attr, val]);
          }
        }

        // Grupo/plano
        await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);
        await db.query("INSERT INTO radusergroup (username, groupname) VALUES (?, ?)", [username, String(p.id)]);

        // Reset do contador via timestamp + vinculo com empresa/plano
        await db.query(`
          INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
          VALUES (?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), nas_id = VALUES(nas_id), empresa_id = VALUES(empresa_id), liberado_em = NOW()
        `, [empresaIdFinal, username, p.id, p.mikrotik_id]);
        await db.query("UPDATE radius_users SET liberado_em = NOW() WHERE username = ?", [username]);

        // Envia CoA pra sessao ativa (muda velocidade e tempo no ar)
        const coaRes = await upgradeSessaoCoA({ username, sessionTimeout: tempoSegundos, rateLimit });
        if (coaRes.ok) {
          const [mkUp] = await db.query("SELECT end_hotspot, ip FROM mikrotiks WHERE id = ? LIMIT 1", [p.mikrotik_id]);
          const gwUp = mkUp[0]?.end_hotspot || mkUp[0]?.ip || null;
          const loginUrlUp = gwUp ? `http://${gwUp}/login?username=${username}&password=${senha}` : "";
          notificarLiberacao({
            empresa_id: empresaIdFinal,
            portal_id: portal_id || null,
            mikrotik_id: p.mikrotik_id,
            telefone: telefone || null,
            cliente_id: cliente_id || null,
            cpf: cpfNumeros || null,
            mac: mac || null,
            contexto_tipo: contexto_tipo || "upgrade",
            referencia_id: referencia_id || null,
            vars: {
              username,
              password: senha,
              plano: p.nome,
              duracao: p.duracao_minutos,
              velocidade: `${p.velocidade_down}M/${p.velocidade_up}M`,
              login_url: loginUrlUp,
              cpf: cpfNumeros || "",
            },
          }).catch(err => console.warn("[liberarUsuario] notificarLiberacao (upgrade) falhou:", err.message));
          if (tempoRestante > 0) await estenderExpiracaoPagamentos({ empresaId: empresaIdFinal, cpfNumeros, mac, totalSegundos: tempoSegundos });
          console.log(`Upgrade sem reconexao (CoA) aplicado para ${username} -> plano ${plano}${tempoRestante ? ` (+${tempoRestante}s acumulados)` : ""}`);
          return { username, password: senha, tempoAcumulado: tempoRestante };
        }
        console.warn(`[liberarUsuario] CoA falhou para ${username} (${coaRes.reason || coaRes.error}); recriando usuario (reconexao).`);
      } catch (upErr) {
        console.warn(`[liberarUsuario] upgrade sem reconexao falhou para ${username}: ${upErr.message}; caindo pro fluxo normal.`);
      }
    }

    // Nova senha aleatoria a cada (re)liberacao; usuarios legados (senha == username)
    // sao regravados aqui. Se o ramo CoA falhou depois de gerar uma, descarta e gera outra.
    senha = gerarSenhaRadius();

    // Remove entradas antigas do RADIUS
    await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
    await db.query("DELETE FROM radreply WHERE username = ?", [username]);
    await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);

    // Reseta o contador total SEM apagar o historico: o sqlcounter 'totalcounter'
    // soma apenas radacct com acctstarttime >= liberado_em. Marca-se o instante da
    // liberacao e o radacct inteiro permanece intacto (compliance Marco Civil na fonte).
    await db.query(`UPDATE radius_users SET liberado_em = NOW() WHERE username = ?`, [username]);

    // Limite TOTAL acumulado (cumulativo, nao diario) + 1 sessao unica
    const checkValues = [
      [username, 'Cleartext-Password', ':=', senha],
      [username, 'Max-All-Session', ':=', String(tempoSegundos)],
      [username, 'Simultaneous-Use', ':=', '1'],
    ];
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES
       (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
      checkValues.flat()
    );

    // Insere perfil de banda e timeout (+ WISPr pra vendors nao-MikroTik)
    const [wisprUpM2, wisprDownM2] = String(rateLimit).split("/").map((v) => parseFloat(v) || 0);
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value) VALUES
        (?, 'Mikrotik-Rate-Limit', ':=', ?),
        (?, 'Session-Timeout', ':=', ?),
        (?, 'WISPr-Bandwidth-Max-Up', ':=', ?),
        (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [username, rateLimit, username, String(tempoSegundos),
       username, String(Math.round(wisprUpM2 * 1000000)), username, String(Math.round(wisprDownM2 * 1000000))]
    );

    // Associa a grupo/plano
    await db.query(
      "INSERT INTO radusergroup (username, groupname) VALUES (?, ?)",
      [username, String(p.id)]
    );

    // Atualiza ou insere vínculo com EMPRESA_ID (liberado_em zera o contador)
    await db.query(`
      INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), nas_id = VALUES(nas_id), empresa_id = VALUES(empresa_id), liberado_em = NOW()
    `, [empresaIdFinal, username, p.id, p.mikrotik_id]);

    // Monta URL de auto-login do hotspot
    const [mkInfo] = await db.query(
      "SELECT end_hotspot, ip FROM mikrotiks WHERE id = ? LIMIT 1",
      [p.mikrotik_id]
    );
    const gateway = mkInfo[0]?.end_hotspot || mkInfo[0]?.ip || null;
    const loginUrl = gateway ? `http://${gateway}/login?username=${username}&password=${senha}` : "";

    // Dispara notificacao WhatsApp via service centralizado.
    // NUNCA bloqueia a liberacao: erros sao logados em whatsapp_logs.
    notificarLiberacao({
      empresa_id: empresaIdFinal,
      portal_id: portal_id || null,
      mikrotik_id: p.mikrotik_id,
      telefone: telefone || null,
      cliente_id: cliente_id || null,
      cpf: cpfNumeros || null,
      mac: mac || null,
      contexto_tipo: contexto_tipo || "liberacao",
      referencia_id: referencia_id || null,
      vars: {
        username,
        password: senha,
        plano: p.nome,
        duracao: p.duracao_minutos,
        velocidade: `${p.velocidade_down}M/${p.velocidade_up}M`,
        login_url: loginUrl,
        cpf: cpfNumeros || "",
      },
    }).catch(err => console.warn("[liberarUsuario] notificarLiberacao falhou:", err.message));

    if (tempoRestante > 0) await estenderExpiracaoPagamentos({ empresaId: empresaIdFinal, cpfNumeros, mac, totalSegundos: tempoSegundos });

    console.log(`Usuario ${username} liberado com plano ${plano} (empresa: ${empresaIdFinal})${tempoRestante ? ` (+${tempoRestante}s acumulados)` : ""}`);
    return { username, password: senha, tempoAcumulado: tempoRestante };
  } catch (error) {
    console.error("Erro ao liberar usuario:", error.message);
    throw error;
  }
}

/**
 * Remove usuário do MikroTik E limpa RADIUS.
 */
async function removerUsuarioPorMac(mac, limparRadius = true) {
  if (!mac || typeof mac !== 'string') {
    console.error("MAC address invalido ou nao fornecido");
    return { success: false, message: "MAC address invalido" };
  }

  let conn;
  let resultados = {
    user: { removed: false },
    active: { removed: false },
    host: { removed: false },
    radius: { removed: false }
  };

  try {
    // Busca a MikroTik associada ao MAC
    const [[mikrotik]] = await db.query(`
      SELECT m.* FROM mikrotiks m
      JOIN pagamentos p ON p.mac = ?
      JOIN planos pl ON pl.id = p.plano_id AND pl.mikrotik_id = m.id
      LIMIT 1
    `, [mac]);

    if (!mikrotik) {
      console.error("Mikrotik nao encontrada para o MAC:", mac);
      // Mesmo sem MikroTik, limpa RADIUS se solicitado
      if (limparRadius) {
        await limparUsuarioRadius(mac);
        resultados.radius = { removed: true };
      }
      return { success: true, message: "RADIUS limpo (MikroTik nao encontrada)", results: resultados };
    }

    conn = new RouterOSAPI({
      host: mikrotik.ip,
      user: mikrotik.usuario,
      password: mikrotik.senha,
      port: mikrotik.porta || 8728,
      keepalive: false,
      timeout: 15000,
    });

    try {
      await conn.connect();
    } catch (connectError) {
      console.error("Falha na conexao com o MikroTik:", connectError.message);
      // MikroTik inacessivel, limpa RADIUS mesmo assim
      if (limparRadius) {
        await limparUsuarioRadius(mac);
        resultados.radius = { removed: true };
      }
      return {
        success: true,
        message: "RADIUS limpo (MikroTik inacessivel)",
        results: resultados
      };
    }

    const processarRemocao = async (caminho) => {
      try {
        const [user] = await conn.write(`${caminho}/print`, [`?mac-address=${mac}`]);
        if (!user || user === '!done' || user === '!empty' || !user['.id']) {
          return { removed: false, message: "Nao encontrado" };
        }
        await conn.write(`${caminho}/remove`, [`=.id=${user['.id']}`]);
        return { removed: true };
      } catch (err) {
        if (err.message.includes('UNKNOWNREPLY') || err.message.includes('!empty') || err.message.includes('no such item')) {
          return { removed: false, message: "Ja removido" };
        }
        return { removed: false, error: err.message };
      }
    };

    resultados.user = await processarRemocao("/ip/hotspot/user");
    resultados.active = await processarRemocao("/ip/hotspot/active");
    resultados.host = await processarRemocao("/ip/hotspot/host");

    // Limpar RADIUS (radcheck, radreply, radusergroup)
    if (limparRadius) {
      await limparUsuarioRadius(mac);
      resultados.radius = { removed: true };
    }

    const sucessoGlobal = Object.values(resultados).some(r => r.removed);
    return {
      success: sucessoGlobal,
      message: sucessoGlobal ? "Operacao concluida" : "Falha na remocao",
      results: resultados
    };
  } catch (err) {
    console.error("Erro geral:", err.message);
    return {
      success: false,
      message: "Erro durante o processo",
      error: err.message,
      results: resultados
    };
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) {}
    }
  }
}

/**
 * Limpa um usuário de todas as tabelas RADIUS.
 * Busca username pelo MAC (CPF ou MAC direto).
 */
async function limparUsuarioRadius(mac) {
  try {
    // Busca username: pode ser CPF ou MAC
    const [checks] = await db.query(
      `SELECT DISTINCT rc.username FROM radcheck rc
       JOIN radacct ra ON ra.username = rc.username
       WHERE ra.callingstationid = ?
       UNION
       SELECT username FROM radcheck WHERE username = ?`,
      [mac, mac]
    );

    for (const { username } of checks) {
      await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
      await db.query("DELETE FROM radreply WHERE username = ?", [username]);
      await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);
      await db.query("DELETE FROM radius_users WHERE username = ?", [username]);
    }
  } catch (err) {
    console.warn("Aviso: erro ao limpar RADIUS por MAC:", err.message);
  }
}

module.exports = { obterInformacoes, liberarUsuario, removerUsuarioPorMac };
