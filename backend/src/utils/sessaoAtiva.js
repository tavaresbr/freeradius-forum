/**
 * Sessao simultanea: o RADIUS permite 1 sessao por usuario (Simultaneous-Use=1), entao quem
 * conecta de outro aparelho e' recusado sem explicacao. Aqui detectamos a sessao aberta e
 * oferecemos derrubar a anterior (Disconnect-Request, com fallback pela API do MikroTik),
 * sem apagar credenciais nem saldo.
 */
const { RouterOSAPI } = require("node-routeros");
const db = require("../../db");
const coa = require("./coa");

// Mesmo criterio do job de sessoes orfas: sem update ha mais de 15 min = nao esta mais conectada
const MINUTOS_ORFA = 15;
const cfg = { esperaMs: 4000, passoMs: 500 }; // ajustavel nos testes

const normMac = (m) => String(m || "").toLowerCase().replace(/[^0-9a-f]/g, "");
const mesmoMac = (a, b) => {
  const x = normMac(a);
  return x.length === 12 && x === normMac(b);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sessao aberta (e viva) do username, restrita a empresa (mesma resolucao da tela de sessoes:
 * NAS-IP -> mikrotiks, senao radius_users.username -> empresa).
 * @returns {Promise<{radacctid:number, acctsessionid:string, nasipaddress:string, callingstationid:string, framedipaddress:string, acctstarttime:Date}|null>}
 */
async function buscarSessaoAtiva(username, empresaId) {
  if (!username || !empresaId) return null;
  const [[row]] = await db.query(
    `SELECT ra.radacctid, ra.acctsessionid, ra.nasipaddress, ra.callingstationid,
            ra.framedipaddress, ra.acctstarttime
       FROM radacct ra
       LEFT JOIN mikrotiks m ON m.ip COLLATE utf8mb4_unicode_ci = ra.nasipaddress COLLATE utf8mb4_unicode_ci
       LEFT JOIN radius_users ru ON ru.username COLLATE utf8mb4_unicode_ci = ra.username COLLATE utf8mb4_unicode_ci
      WHERE ra.username = ? AND ra.acctstoptime IS NULL
        AND COALESCE(ra.acctupdatetime, ra.acctstarttime) > NOW() - INTERVAL ${MINUTOS_ORFA} MINUTE
        AND COALESCE(m.empresa_id, ru.empresa_id) = ?
      ORDER BY ra.acctstarttime DESC LIMIT 1`,
    [username, empresaId]
  );
  return row || null;
}

/** Fallback: remove so a conexao ativa do usuario no hotspot do MikroTik (nao toca RADIUS). */
async function removerAtivaMikrotik({ sessao, username, empresaId }) {
  let conn;
  try {
    const [[mk]] = await db.query(
      "SELECT ip, usuario, senha, porta FROM mikrotiks WHERE ip = ? AND empresa_id = ? LIMIT 1",
      [sessao.nasipaddress, empresaId]
    );
    if (!mk || !mk.usuario) return { ok: false, reason: "no_mikrotik" };
    conn = new RouterOSAPI({ host: mk.ip, user: mk.usuario, password: mk.senha, port: mk.porta || 8728, keepalive: false, timeout: 10000 });
    await conn.connect();
    const ativos = await conn.write("/ip/hotspot/active/print", [`?user=${username}`]);
    const lista = Array.isArray(ativos) ? ativos.filter((a) => a && a[".id"]) : [];
    for (const a of lista) await conn.write("/ip/hotspot/active/remove", [`=.id=${a[".id"]}`]);
    return { ok: lista.length > 0, removidos: lista.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) { try { await conn.close(); } catch (_) { /* ignora */ } }
  }
}

async function aindaAberta(radacctid) {
  const [[r]] = await db.query("SELECT acctstoptime FROM radacct WHERE radacctid = ?", [radacctid]);
  return !!r && r.acctstoptime == null;
}

/**
 * Derruba a sessao: Disconnect-Request, senao API do MikroTik. Espera o Accounting-Stop;
 * se o NAS aceitou mas o stop nao chegou a tempo, fecha a linha (como o job de orfas).
 * Nunca apaga credenciais. Sem metodo que funcione -> { ok:false } e a linha NAO e' fechada.
 * @returns {Promise<{ok:boolean, metodo?:string, motivo?:string}>}
 */
async function desconectarSessao({ sessao, username, empresaId }) {
  let metodo = null;
  const r1 = await coa.desconectarSessaoCoA({ username, sessao });
  if (r1 && r1.ok) metodo = "disconnect";
  if (!metodo) {
    const r2 = await removerAtivaMikrotik({ sessao, username, empresaId });
    if (r2 && r2.ok) metodo = "mikrotik-api";
  }
  if (!metodo) return { ok: false, motivo: "O equipamento nao aceitou a desconexao remota" };

  for (let t = 0; t < cfg.esperaMs; t += cfg.passoMs) {
    if (!(await aindaAberta(sessao.radacctid))) return { ok: true, metodo };
    await dormir(cfg.passoMs);
  }
  await db.query(
    "UPDATE radacct SET acctstoptime = NOW(), acctterminatecause = 'Admin-Reset' WHERE radacctid = ? AND acctstoptime IS NULL",
    [sessao.radacctid]
  );
  return { ok: true, metodo };
}

/**
 * Chamado antes de mandar o cliente ao login final. Devolve campos para mesclar na resposta:
 *  - nada ({}) se nao ha sessao aberta, ou se era o MESMO aparelho (sessao velha: derrubada sozinha);
 *  - { requer_desconexao:true, sessao_ativa:{desde, aparelho} } se ha sessao em OUTRO aparelho.
 * Com manterMesmoAparelho (fluxos de pagamento) a sessao do MESMO aparelho tambem devolve {} sem ser derrubada.
 */
async function tratarSessaoAtiva({ username, mac, empresaId, manterMesmoAparelho = false }) {
  try {
    const sessao = await buscarSessaoAtiva(username, empresaId);
    if (!sessao) return {};
    if (mesmoMac(sessao.callingstationid, mac)) {
      // Pagamento: a sessao do proprio aparelho (ex.: trial) ja recebeu o upgrade por CoA; derrubar causaria queda
      if (manterMesmoAparelho) return {};
      const r = await desconectarSessao({ sessao, username, empresaId });
      if (r.ok) return {};
    }
    const mm = normMac(sessao.callingstationid);
    return {
      requer_desconexao: true,
      sessao_ativa: {
        desde: sessao.acctstarttime ? new Date(sessao.acctstarttime).toISOString() : null,
        aparelho: mm.length === 12 ? `…${mm.slice(8, 10).toUpperCase()}:${mm.slice(10, 12).toUpperCase()}` : null,
      },
    };
  } catch (err) {
    // Nunca bloqueia o login por falha desta checagem
    console.warn("[sessaoAtiva] checagem ignorada:", err.message);
    return {};
  }
}

/**
 * Prova de que ESTE aparelho acabou de pagar com o CPF: pagamento aprovado da empresa, mesmo CPF e MAC,
 * liberado ha menos de 30 min. (O acesso pago nao e' "gratis" e o aparelho novo nunca usou o username.)
 */
async function pagamentoRecenteDoAparelho({ cpf, mac, empresaId }) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  const macN = normMac(mac);
  if (cpfLimpo.length !== 11 || macN.length !== 12 || !empresaId) return false;
  const [rows] = await db.query(
    `SELECT 1 FROM pagamentos
      WHERE empresa_id = ? AND status = 'approved'
        AND REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') = ?
        AND LOWER(REPLACE(REPLACE(mac,':',''),'-','')) = ?
        AND liberado_em > NOW() - INTERVAL 30 MINUTE
      LIMIT 1`,
    [empresaId, cpfLimpo, macN]
  );
  return rows.length > 0;
}

module.exports = { pagamentoRecenteDoAparelho, buscarSessaoAtiva, desconectarSessao, tratarSessaoAtiva, mesmoMac, normMac, _cfg: cfg };
