// Trilha de ativacao de equipamento: checklist derivado de dados que ja existem
// (sem migration). calcularTrilha e' pura; buscarFatos faz 3 consultas agregadas
// por empresa (nunca por equipamento) e tolera tabela/coluna ausente.

const USA_RADIUS = ["mikrotik", "omada", "grandstream"];
const TUTORIAIS = { omada: "tutorial-omada", unifi: "tutorial-unifi", grandstream: "tutorial-grandstream" };

const tipoDe = (m) => m.tipo || "mikrotik";

/**
 * Estados: ok | pendente | manual | na | desconhecido.
 * `acao` e' um identificador que o front traduz em botao/atalho.
 */
function calcularTrilha(m, fatos = {}) {
  const tipo = tipoDe(m);
  const nasSet = fatos.nas; // Set de nasname | undefined (consulta falhou)
  const planos = fatos.planos; // { porEquipamento: Map, semEquipamento: n } | undefined
  const sessoes = (fatos.sessoes && fatos.sessoes.get(m.id)) || null;
  const etapas = [];

  etapas.push({ chave: "cadastro", titulo: "Equipamento cadastrado", estado: "ok", detalhe: m.nome || "" });

  etapas.push({
    chave: "conectividade",
    titulo: "Conectividade",
    estado: "pendente", // o front promove para ok/pendente conforme o teste ao vivo
    detalhe: "Testa a comunicação com o equipamento.",
    acao: "testar",
  });

  if (!USA_RADIUS.includes(tipo)) {
    etapas.push({ chave: "radius", titulo: "RADIUS (NAS)", estado: "na", detalhe: "Este tipo não usa RADIUS." });
  } else if (!nasSet) {
    etapas.push({ chave: "radius", titulo: "RADIUS (NAS)", estado: "desconhecido", detalhe: "Não foi possível verificar." });
  } else if (nasSet.has(m.ip)) {
    etapas.push({ chave: "radius", titulo: "RADIUS (NAS)", estado: "ok", detalhe: "Cliente RADIUS cadastrado." });
  } else {
    etapas.push({ chave: "radius", titulo: "RADIUS (NAS)", estado: "pendente", detalhe: "NAS não encontrado. Salve o equipamento de novo.", acao: "editar" });
  }

  if (tipo === "mikrotik") {
    etapas.push(m.end_hotspot
      ? { chave: "hotspot", titulo: "Hotspot configurado", estado: "ok", detalhe: m.end_hotspot }
      : { chave: "hotspot", titulo: "Hotspot configurado", estado: "pendente", detalhe: "Envie o hotspot ao roteador.", acao: "hotspot" });
  } else {
    etapas.push({
      chave: "hotspot",
      titulo: "Portal externo no controller",
      estado: "manual",
      detalhe: "Configurado no controller; siga o tutorial.",
      acao: "tutorial",
      tutorial: TUTORIAIS[tipo] || null,
    });
  }

  etapas.push(m.portal_id
    ? { chave: "portal", titulo: "Portal vinculado", estado: "ok", detalhe: m.portal_nome || "" }
    : { chave: "portal", titulo: "Portal vinculado", estado: "pendente", detalhe: "Escolha o portal do equipamento.", acao: "editar" });

  if (!planos) {
    etapas.push({ chave: "plano", titulo: "Plano disponível", estado: "desconhecido", detalhe: "Não foi possível verificar." });
  } else {
    const n = (planos.porEquipamento.get(m.id) || 0) + (planos.semEquipamento || 0);
    etapas.push(n > 0
      ? { chave: "plano", titulo: "Plano disponível", estado: "ok", detalhe: `${n} plano(s) ativo(s).` }
      : { chave: "plano", titulo: "Plano disponível", estado: "pendente", detalhe: "Nenhum plano ativo para este equipamento.", acao: "planos" });
  }

  if (!fatos.sessoes) {
    etapas.push({ chave: "conexao", titulo: "Primeira conexão real", estado: "desconhecido", detalhe: "Não foi possível verificar." });
  } else if (sessoes && sessoes.total > 0) {
    etapas.push({ chave: "conexao", titulo: "Primeira conexão real", estado: "ok", detalhe: `${sessoes.total} sessão(ões) registrada(s).`, primeira: sessoes.primeira });
  } else {
    etapas.push({ chave: "conexao", titulo: "Primeira conexão real", estado: "pendente", detalhe: "Conecte um celular ao Wi-Fi e faça o login no portal." });
  }

  return resumir(etapas, sessoes ? sessoes.abertas : 0);
}

function resumir(etapas, usuariosAtivos) {
  const aplicaveis = etapas.filter((e) => e.estado !== "na");
  const concluidas = aplicaveis.filter((e) => e.estado === "ok").length;
  return { etapas, concluidas, total: aplicaveis.length, usuarios_ativos: usuariosAtivos };
}

async function seguro(fn) {
  try { return await fn(); } catch (e) { console.error("[trilha]", e.message); return undefined; }
}

async function buscarFatos(db, empresaId) {
  const nas = await seguro(async () => {
    const [rows] = await db.execute("SELECT nasname FROM nas WHERE empresa_id = ?", [empresaId]);
    return new Set(rows.map((r) => r.nasname));
  });
  const planos = await seguro(async () => {
    const [rows] = await db.execute(
      "SELECT mikrotik_id, COUNT(*) AS total FROM planos WHERE empresa_id = ? AND ativo = 1 GROUP BY mikrotik_id",
      [empresaId]
    );
    const porEquipamento = new Map();
    let semEquipamento = 0;
    for (const r of rows) {
      if (r.mikrotik_id == null) semEquipamento += Number(r.total);
      else porEquipamento.set(r.mikrotik_id, Number(r.total));
    }
    return { porEquipamento, semEquipamento };
  });
  const sessoes = await seguro(async () => {
    const [rows] = await db.execute(
      `SELECT m.id AS mikrotik_id, COUNT(*) AS total,
              SUM(CASE WHEN ra.acctstoptime IS NULL THEN 1 ELSE 0 END) AS abertas,
              MIN(ra.acctstarttime) AS primeira
       FROM radacct ra
       JOIN mikrotiks m ON m.ip COLLATE utf8mb4_unicode_ci = ra.nasipaddress COLLATE utf8mb4_unicode_ci
       WHERE m.empresa_id = ?
       GROUP BY m.id`,
      [empresaId]
    );
    const mapa = new Map();
    for (const r of rows) mapa.set(r.mikrotik_id, { total: Number(r.total), abertas: Number(r.abertas || 0), primeira: r.primeira });
    return mapa;
  });
  return { nas, planos, sessoes };
}

async function trilhaDaEmpresa(db, empresaId) {
  const [equipamentos] = await db.execute(
    `SELECT m.id, m.nome, m.ip, m.tipo, m.portal_id, m.end_hotspot, p.nome AS portal_nome
     FROM mikrotiks m LEFT JOIN portais p ON m.portal_id = p.id
     WHERE m.empresa_id = ?`,
    [empresaId]
  );
  const fatos = await buscarFatos(db, empresaId);
  const out = {};
  for (const m of equipamentos) out[m.id] = calcularTrilha(m, fatos);
  return out;
}

module.exports = { calcularTrilha, buscarFatos, trilhaDaEmpresa };
