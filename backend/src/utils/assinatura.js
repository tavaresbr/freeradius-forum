const db = require("../../db");

const TRIAL_DIAS = 7;
const CACHE_MS = 60 * 1000;
const cache = new Map();

/**
 * Estado da assinatura a partir da linha do banco (funcao pura, testavel).
 * Fim do periodo = trial_ate (trial) ou vence_em. Vencida = passou do fim; ainda
 * acessa durante `carencia_dias`; depois disso `bloqueada` (so o painel admin).
 */
function calcularEstado(row, agora = new Date()) {
  if (!row) return { status: "sem_assinatura", bloqueada: true, expirado: true, dias_restantes: 0, fim: null };
  const fimRaw = row.status === "trial" ? row.trial_ate : row.vence_em;
  const fim = fimRaw ? new Date(fimRaw) : null;
  const carencia = Number.isFinite(Number(row.carencia_dias)) ? Number(row.carencia_dias) : 3;
  const base = { plano_id: row.plano_id || null, fim, carencia_dias: carencia };

  if (row.status === "cancelada") return { ...base, status: "cancelada", bloqueada: true, expirado: true, dias_restantes: 0 };
  if (!fim) return { ...base, status: "vencida", bloqueada: true, expirado: true, dias_restantes: 0 };

  const dias = Math.ceil((fim.getTime() - agora.getTime()) / 86400000);
  const expirado = fim.getTime() < agora.getTime();
  const limite = fim.getTime() + carencia * 86400000;
  return {
    ...base,
    status: expirado ? "vencida" : row.status,
    expirado,
    em_carencia: expirado && agora.getTime() <= limite,
    bloqueada: expirado && agora.getTime() > limite,
    dias_restantes: dias,
  };
}

function tabelaInexistente(err) {
  return err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146);
}

/** Limite efetivo = limite do plano + adicionais vigentes. NULL (ilimitado) continua ilimitado. */
function limiteEfetivo(base, extra) {
  if (base == null) return null;
  return Number(base) + (Number(extra) || 0);
}

/** Adicionais vigentes (vence_em >= agora) da empresa. Sem a migration 041, nao ha adicionais. */
async function adicionaisVigentes(empresaId) {
  try {
    const [rows] = await db.execute(
      `SELECT aa.id, aa.adicional_id, aa.quantidade, aa.vence_em, a.nome, a.tipo, a.incremento, a.valor, a.ciclo_dias
         FROM assinatura_adicionais aa JOIN saas_adicionais a ON a.id = aa.adicional_id
        WHERE aa.empresa_id = ? AND aa.vence_em >= NOW() ORDER BY aa.vence_em`,
      [empresaId]
    );
    return rows || [];
  } catch (err) {
    if (tabelaInexistente(err)) return [];
    throw err;
  }
}

/** Estado + plano/limites da empresa (cache de 60s). Limites ja incluem os adicionais vigentes. */
async function obterStatus(empresaId) {
  const hit = cache.get(empresaId);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;

  // p.* traz tambem as colunas da migration 043 quando existirem (sem ela o painel segue como antes).
  const [[row]] = await db.execute(
    `SELECT a.plano_id, a.status, a.trial_ate, a.vence_em, a.carencia_dias,
            p.*, p.nome AS plano_nome, p.valor AS plano_valor
       FROM assinaturas a LEFT JOIN saas_planos p ON p.id = a.plano_id
      WHERE a.empresa_id = ? LIMIT 1`,
    [empresaId]
  );
  const vigentes = await adicionaisVigentes(empresaId);
  const extras = { equipamentos: 0, admins: 0, portais: 0 };
  for (const a of vigentes) {
    if (a.tipo in extras) extras[a.tipo] += (Number(a.incremento) || 0) * (Number(a.quantidade) || 0);
  }
  const agora = Date.now();
  // Recurso liga/desliga: o plano inclui OU ha adicional vigente do tipo. Sem a migration 043 (coluna ausente)
  // `recursos_migrados` fica false e nada e bloqueado.
  const migrado = row ? "inclui_whatsapp" in row : false;
  const tem = (tipo) => vigentes.some((a) => a.tipo === tipo);
  const recursos = {
    whatsapp: !migrado || !!row.inclui_whatsapp || tem("whatsapp"),
    campanhas: !migrado || !!row.inclui_campanhas || tem("campanhas"),
    exportacao: !migrado || !!row.inclui_exportacao || tem("exportacao"),
    // Dominio proprio vem da migration 046 (coluna propria): sem ela nao bloqueia.
    dominio: !(row && "inclui_dominio" in row) || !!row.inclui_dominio || tem("dominio"),
  };
  const v = { ...calcularEstado(row), plano_nome: row?.plano_nome || null, plano_valor: row?.plano_valor ?? null,
              plano_max_equipamentos: row?.max_equipamentos ?? null, plano_max_admins: row?.max_admins ?? null,
              max_equipamentos: limiteEfetivo(row?.max_equipamentos ?? null, extras.equipamentos),
              max_admins: limiteEfetivo(row?.max_admins ?? null, extras.admins),
              max_portais: limiteEfetivo(row?.max_portais ?? null, extras.portais),
              plano_max_portais: row?.max_portais ?? null,
              recursos, extras,
              plano_recursos: { whatsapp: !migrado || !!row.inclui_whatsapp, campanhas: !migrado || !!row.inclui_campanhas, exportacao: !migrado || !!row.inclui_exportacao, dominio: !(row && "inclui_dominio" in row) || !!row.inclui_dominio },
              adicionais: vigentes.map((a) => ({
                id: a.id, adicional_id: a.adicional_id, nome: a.nome, tipo: a.tipo, quantidade: a.quantidade,
                valor: Number(a.valor), vence_em: a.vence_em,
                dias_restantes: Math.ceil((new Date(a.vence_em).getTime() - agora) / 86400000),
              })) };
  cache.set(empresaId, { t: Date.now(), v });
  return v;
}

function invalidar(empresaId) {
  if (empresaId == null) cache.clear();
  else cache.delete(Number(empresaId));
}

/** Cria o trial da empresa (executor: pool ou conexao de transacao). */
async function criarTrial(executor, empresaId, planoId = null) {
  let id = planoId ? Number(planoId) : null;
  if (id) {
    const [[ok]] = await executor.execute("SELECT id FROM saas_planos WHERE id = ? AND ativo = 1", [id]);
    if (!ok) id = null;
  }
  if (!id) {
    const [[p]] = await executor.execute("SELECT id FROM saas_planos WHERE ativo = 1 ORDER BY ordem, id LIMIT 1");
    id = p ? p.id : null;
  }
  await executor.execute(
    `INSERT INTO assinaturas (empresa_id, plano_id, status, trial_ate)
     VALUES (?, ?, 'trial', DATE_ADD(NOW(), INTERVAL ${TRIAL_DIAS} DAY))
     ON DUPLICATE KEY UPDATE empresa_id = empresa_id`,
    [empresaId, id]
  );
}

const CONTAGENS = {
  equipamentos: { sql: "SELECT COUNT(*) AS n FROM mikrotiks WHERE empresa_id = ?", campo: "max_equipamentos", rotulo: "equipamentos" },
  admins: { sql: "SELECT COUNT(*) AS n FROM admins WHERE empresa_id = ?", campo: "max_admins", rotulo: "administradores" },
  portais: { sql: "SELECT COUNT(*) AS n FROM portais WHERE empresa_id = ?", campo: "max_portais", rotulo: "portais" },
};

/** Uso atual vs limite do plano. `ok:false` quando criar mais um passaria do limite. */
async function checarLimite(empresaId, tipo) {
  const def = CONTAGENS[tipo];
  const st = await obterStatus(empresaId);
  const limite = st[def.campo];
  const [[{ n }]] = await db.execute(def.sql, [empresaId]);
  if (limite == null) return { ok: true, limite: null, usado: n };
  return { ok: n < limite, limite, usado: n, mensagem: `Limite do plano atingido: ${limite} ${def.rotulo}. Faça upgrade da assinatura.` };
}

/** Falha de infraestrutura (ex.: migration 031 ainda nao rodou) nao pode travar o painel. */
async function checarLimiteSeguro(empresaId, tipo) {
  try {
    return await checarLimite(empresaId, tipo);
  } catch (err) {
    if (!tabelaInexistente(err)) console.error("[assinatura] erro ao checar limite:", err.message);
    return { ok: true };
  }
}

/** A empresa tem o recurso (whatsapp|campanhas|exportacao)? Sem a migration 031/043 libera (compat). */
async function temRecurso(empresaId, nome) {
  try {
    const st = await obterStatus(empresaId);
    return st.recursos ? st.recursos[nome] !== false : true;
  } catch (err) {
    if (tabelaInexistente(err)) return true;
    throw err;
  }
}

module.exports = { temRecurso, TRIAL_DIAS, limiteEfetivo, adicionaisVigentes, calcularEstado, obterStatus, invalidar, criarTrial, checarLimite, checarLimiteSeguro, tabelaInexistente };
