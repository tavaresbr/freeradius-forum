const db = require("../../db");
const { gerarSenhaRadius } = require("../utils/radiusPassword");
const { verificarSaldoRadius } = require("../utils/leadUtils");
const { montarGatewayInfo } = require("../gateways/gatewayLiberacao");
const { tratarSessaoAtiva } = require("../utils/sessaoAtiva");
const { gerarCodigo, normalizarCodigo, codigoPersonalizadoValido, quantidadeValida, validarValidade, celulaCsv } = require("../utils/voucher");
const { normalizarMac, normalizarIp, normalizarId } = require("../utils/entradaSegura");

const MSG_INVALIDO = "Código inválido, já utilizado ou de outro local.";

// ---------- Admin (tudo filtrado por empresa_id) ----------

exports.listar = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const where = ["v.empresa_id = ?"];
    const params = [empresaId];
    const { status, lote, q, equipamento } = req.query;
    if (normalizarId(equipamento)) { where.push("v.mikrotik_id = ?"); params.push(Number(equipamento)); }
    if (["disponivel", "usado", "cancelado"].includes(status)) { where.push("v.status = ?"); params.push(status); }
    if (typeof lote === "string" && lote) { where.push("v.lote = ?"); params.push(lote.slice(0, 60)); }
    if (typeof q === "string" && q.trim()) { where.push("v.codigo LIKE ?"); params.push(`%${normalizarCodigo(q)}%`); }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [rows] = await db.query(
      `SELECT v.id, v.codigo, v.plano_id, p.nome AS plano_nome, p.duracao_minutos AS plano_minutos, v.mikrotik_id AS equipamento_id, m.nome AS equipamento_nome,
              mu.nome AS usado_equipamento, v.lote, v.status, v.valido_ate,
              v.usado_em, v.usado_mac, v.criado_em
         FROM vouchers v
         LEFT JOIN planos p ON p.id = v.plano_id
         LEFT JOIN mikrotiks m ON m.id = v.mikrotik_id AND m.empresa_id = v.empresa_id
         LEFT JOIN radius_users ru ON ru.username = v.username AND ru.empresa_id = v.empresa_id
         LEFT JOIN mikrotiks mu ON mu.id = ru.nas_id AND mu.empresa_id = v.empresa_id
        WHERE ${where.join(" AND ")} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const [[tot]] = await db.query(`SELECT COUNT(*) AS total FROM vouchers v WHERE ${where.join(" AND ")}`, params);
    const [cont] = await db.query("SELECT status, COUNT(*) AS n FROM vouchers WHERE empresa_id = ? GROUP BY status", [empresaId]);
    const [lotes] = await db.query("SELECT DISTINCT lote FROM vouchers WHERE empresa_id = ? AND lote IS NOT NULL ORDER BY lote", [empresaId]);
    const contadores = { disponivel: 0, usado: 0, cancelado: 0 };
    cont.forEach((c) => { contadores[c.status] = c.n; });
    res.json({ success: true, empresa_id: empresaId, data: rows, total: tot.total, page, limit, contadores, lotes: lotes.map((l) => l.lote) });
  } catch (err) {
    console.error("[vouchers] listar:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE") return res.status(500).json({ error: "Atualização do banco pendente: rode a migration 043 (node migrations/043_vouchers.js)." });
    res.status(500).json({ error: "Erro ao listar vouchers" });
  }
};

exports.criarLote = async (req, res) => {
  try {
    const empresaId = req.empresa_id;
    const { plano_id, mikrotik_id, quantidade, codigo, lote, valido_ate } = req.body || {};
    const planoId = normalizarId(plano_id);
    if (!planoId) return res.status(400).json({ error: "Escolha o plano do voucher" });
    const [[plano]] = await db.query("SELECT id FROM planos WHERE id = ? AND empresa_id = ?", [planoId, empresaId]);
    if (!plano) return res.status(400).json({ error: "Plano inválido" });
    const equipId = normalizarId(mikrotik_id);
    if (!equipId) return res.status(400).json({ error: "Escolha o equipamento do voucher" });
    const [[equip]] = await db.query("SELECT id FROM mikrotiks WHERE id = ? AND empresa_id = ?", [equipId, empresaId]);
    if (!equip) return res.status(400).json({ error: "Equipamento inválido" });

    const validade = validarValidade(valido_ate);
    if (validade === undefined) return res.status(400).json({ error: "Data de validade inválida" });
    const nomeLote = typeof lote === "string" && lote.trim() ? lote.trim().slice(0, 60) : null;

    let codigos;
    if (codigo !== undefined && codigo !== null && codigo !== "") {
      const c = normalizarCodigo(codigo);
      if (!codigoPersonalizadoValido(c)) return res.status(400).json({ error: "Código personalizado: 4 a 32 letras/números" });
      codigos = [c];
    } else {
      const n = quantidadeValida(quantidade);
      if (!n) return res.status(400).json({ error: "Quantidade deve ser de 1 a 500" });
      const set = new Set();
      while (set.size < n) set.add(gerarCodigo());
      codigos = [...set];
    }

    const criados = [];
    for (const c of codigos) {
      try {
        await db.execute(
          "INSERT INTO vouchers (empresa_id, codigo, plano_id, mikrotik_id, lote, valido_ate, criado_por) VALUES (?,?,?,?,?,?,?)",
          [empresaId, c, planoId, equip.id, nomeLote, validade, req.user?.id || null]
        );
        criados.push(c);
      } catch (e) {
        if (e.code !== "ER_DUP_ENTRY") throw e;
        if (codigos.length === 1) return res.status(409).json({ error: "Já existe um voucher com este código" });
        // colisao rara em lote: gera outro codigo
        let novo;
        do { novo = gerarCodigo(); } while (codigos.includes(novo));
        codigos.push(novo);
      }
    }
    res.status(201).json({ success: true, criados: criados.length, codigos: criados });
  } catch (err) {
    console.error("[vouchers] criarLote:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE") return res.status(500).json({ error: "Atualização do banco pendente: rode a migration 043 (node migrations/043_vouchers.js)." });
    res.status(500).json({ error: "Erro ao criar vouchers" });
  }
};

exports.cancelar = async (req, res) => {
  try {
    const [r] = await db.execute(
      "UPDATE vouchers SET status = 'cancelado' WHERE id = ? AND empresa_id = ? AND status = 'disponivel'",
      [req.params.id, req.empresa_id]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Só é possível cancelar vouchers disponíveis" });
    res.json({ success: true });
  } catch (err) {
    console.error("[vouchers] cancelar:", err.message);
    res.status(500).json({ error: "Erro ao cancelar voucher" });
  }
};

exports.excluir = async (req, res) => {
  try {
    const [r] = await db.execute(
      "DELETE FROM vouchers WHERE id = ? AND empresa_id = ? AND status <> 'usado'",
      [req.params.id, req.empresa_id]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Voucher já utilizado não pode ser excluído" });
    res.json({ success: true });
  } catch (err) {
    console.error("[vouchers] excluir:", err.message);
    res.status(500).json({ error: "Erro ao excluir voucher" });
  }
};

exports.exportarCSV = async (req, res) => {
  try {
    const params = [req.empresa_id];
    let filtro = "";
    if (typeof req.query.lote === "string" && req.query.lote) { filtro += " AND v.lote = ?"; params.push(req.query.lote.slice(0, 60)); }
    if (["disponivel", "usado", "cancelado"].includes(req.query.status)) { filtro += " AND v.status = ?"; params.push(req.query.status); }
    if (normalizarId(req.query.equipamento)) { filtro += " AND v.mikrotik_id = ?"; params.push(Number(req.query.equipamento)); }
    const [rows] = await db.query(
      `SELECT v.codigo, p.nome AS plano, m.nome AS equipamento, mu.nome AS usado_equipamento,
              v.lote, v.status, v.valido_ate, v.usado_em
         FROM vouchers v
         LEFT JOIN planos p ON p.id = v.plano_id
         LEFT JOIN mikrotiks m ON m.id = v.mikrotik_id AND m.empresa_id = v.empresa_id
         LEFT JOIN radius_users ru ON ru.username = v.username AND ru.empresa_id = v.empresa_id
         LEFT JOIN mikrotiks mu ON mu.id = ru.nas_id AND mu.empresa_id = v.empresa_id
        WHERE v.empresa_id = ?${filtro} ORDER BY v.id`,
      params
    );
    const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
    const linhas = [["Codigo", "Plano", "Equipamento", "Lote", "Status", "Valido ate", "Usado em", "Usado no equipamento"].join(";")];
    rows.forEach((r) => linhas.push([r.codigo, r.plano, r.equipamento, r.lote, r.status, dia(r.valido_ate), r.usado_em ? new Date(r.usado_em).toISOString() : "", r.usado_equipamento].map(celulaCsv).join(";")));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="vouchers.csv"');
    res.send("﻿" + linhas.join("\n"));
  } catch (err) {
    console.error("[vouchers] exportar:", err.message);
    res.status(500).json({ error: "Erro ao exportar vouchers" });
  }
};

// ---------- Publico: resgate no portal ----------

// Falhas (4xx) contam no limiter por IP/MAC; o sucesso nao.
exports.resgatar = async (req, res) => {
  try {
    const codigo = normalizarCodigo(req.body?.codigo);
    const mikrotikId = normalizarId(req.body?.mikrotik_id);
    const mac = normalizarMac(req.body?.mac);
    const ip = normalizarIp(req.body?.ip);
    if (!codigo || !mikrotikId) return res.status(400).json({ error: MSG_INVALIDO });

    const [[mtk]] = await db.execute("SELECT id, empresa_id, ip, end_hotspot FROM mikrotiks WHERE id = ?", [mikrotikId]);
    if (!mtk) return res.status(404).json({ error: "Equipamento não encontrado" });
    const empresaId = mtk.empresa_id;

    const [[v]] = await db.execute(
      `SELECT v.id, v.status, v.valido_ate, v.usado_mac, v.username, v.plano_id, v.mikrotik_id,
              (v.valido_ate IS NOT NULL AND v.valido_ate < CURDATE()) AS expirado
         FROM vouchers v WHERE v.empresa_id = ? AND v.codigo = ?`,
      [empresaId, codigo]
    );
    if (!v || v.status === "cancelado") return res.status(403).json({ error: MSG_INVALIDO });
    // Voucher exclusivo por equipamento (NULL = legado, vale em qualquer equipamento da empresa).
    if (v.mikrotik_id != null && String(v.mikrotik_id) !== String(mtk.id)) return res.status(403).json({ error: MSG_INVALIDO });

    const gateway = mtk.end_hotspot || mtk.ip;

    // Voucher ja usado: so o mesmo aparelho reconecta, e so com saldo (devolve as credenciais gravadas).
    if (v.status === "usado") {
      const macLimpo = (s) => String(s || "").toLowerCase().replace(/[^0-9a-f]/g, "");
      if (!mac || macLimpo(mac) !== macLimpo(v.usado_mac)) return res.status(403).json({ error: MSG_INVALIDO });
      const saldo = await verificarSaldoRadius(v.username);
      if (!saldo.existe || !saldo.temSaldo) return res.status(403).json({ error: MSG_INVALIDO });
      return res.json({
        success: true, gateway, username: v.username, password: saldo.password,
        ...(await tratarSessaoAtiva({ username: v.username, mac, empresaId, autorizado: true })),
        gateway_info: await montarGatewayInfo({ mikrotik_id: mtk.id, empresa_id: empresaId, mac, username: v.username, duracaoSegundos: saldo.tempoRestante }),
      });
    }
    if (v.expirado) return res.status(403).json({ error: MSG_INVALIDO });

    const [[plano]] = await db.execute(
      "SELECT id, duracao_minutos, velocidade_down, velocidade_up FROM planos WHERE id = ? AND empresa_id = ?",
      [v.plano_id, empresaId]
    );
    if (!plano) return res.status(400).json({ error: "O plano deste voucher não está mais disponível. Fale com o estabelecimento." });

    const username = `voucher_${codigo.toLowerCase()}`;
    // Reivindicacao atomica: so um resgate vence a corrida.
    const [claim] = await db.execute(
      "UPDATE vouchers SET status = 'usado', usado_em = NOW(), usado_mac = ?, usado_ip = ?, username = ? WHERE id = ? AND status = 'disponivel'",
      [mac || null, ip || null, username, v.id]
    );
    if (!claim.affectedRows) return res.status(403).json({ error: MSG_INVALIDO });

    const senha = gerarSenhaRadius();
    const tempoSegundos = plano.duracao_minutos * 60;
    const rateLimit = `${plano.velocidade_up}M/${plano.velocidade_down}M`;
    const upBps = Math.round(Number(plano.velocidade_up) * 1000000);
    const downBps = Math.round(Number(plano.velocidade_down) * 1000000);

    await db.query("DELETE FROM radcheck WHERE username = ?", [username]);
    await db.query("DELETE FROM radreply WHERE username = ?", [username]);
    await db.query("DELETE FROM radusergroup WHERE username = ?", [username]);
    await db.query(
      `INSERT INTO radcheck (username, attribute, op, value)
       VALUES (?, 'Cleartext-Password', ':=', ?), (?, 'Max-All-Session', ':=', ?), (?, 'Simultaneous-Use', ':=', '1')`,
      [username, senha, username, String(tempoSegundos), username]
    );
    await db.query(
      `INSERT INTO radreply (username, attribute, op, value)
       VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?), (?, 'Session-Timeout', ':=', ?),
              (?, 'WISPr-Bandwidth-Max-Up', ':=', ?), (?, 'WISPr-Bandwidth-Max-Down', ':=', ?)`,
      [username, rateLimit, username, tempoSegundos, username, String(upBps), username, String(downBps)]
    );
    await db.query("INSERT INTO radusergroup (username, groupname) VALUES (?, ?)", [username, plano.id]);
    await db.query(
      `INSERT INTO radius_users (empresa_id, username, plano_id, nas_id, liberado_em)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE plano_id = VALUES(plano_id), nas_id = VALUES(nas_id), empresa_id = VALUES(empresa_id), liberado_em = NOW()`,
      [empresaId, username, plano.id, mtk.id]
    );

    res.json({
      success: true, gateway, username, password: senha,
      ...(await tratarSessaoAtiva({ username, mac, empresaId })),
      gateway_info: await montarGatewayInfo({ mikrotik_id: mtk.id, empresa_id: empresaId, mac, username, duracaoSegundos: tempoSegundos }),
    });
  } catch (err) {
    console.error("[vouchers] resgatar:", err.message);
    res.status(500).json({ error: "Erro ao validar o voucher" });
  }
};
