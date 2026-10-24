const db = require("../../db");
const { normalizarDataNascimento } = require("./dataNascimento");
const { normalizarCampos } = require("./camposPortal");
const dobTentativas = require("./dobTentativas");

/**
 * Verifica se já existe um lead com o CPF informado para a empresa.
 * @param {string} cpf - CPF (pode ter máscara)
 * @param {number|null} empresaId
 * @returns {Object|null} lead existente ou null
 */
async function verificarLeadExistente(cpf, empresaId) {
  if (!cpf) return null;
  const cpfLimpo = cpf.replace(/\D/g, "");
  if (cpfLimpo.length < 11) return null;

  let query = "SELECT id, nome, email, telefone, cpf, mac, origem, criado_em FROM leads WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ?";
  const params = [cpfLimpo];

  if (empresaId) {
    query += " AND empresa_id = ?";
    params.push(empresaId);
  }

  query += " ORDER BY criado_em DESC LIMIT 1";
  const [[existing]] = await db.execute(query, params);
  return existing || null;
}

/**
 * Busca o cadastro (nome e telefone) de um CPF, mas SO se a data de nascimento
 * gravada for igual a informada (segundo fator contra consulta de dados de terceiros).
 * Exige empresa: nunca consulta entre empresas. Nao revela por que nao achou
 * (CPF inexistente, data diferente e cadastro antigo sem data dao o mesmo resultado: null).
 * @param {string} cpf - com ou sem mascara
 * @param {string} dataIso - 'AAAA-MM-DD'
 * @param {number} empresaId
 * @returns {Promise<{nome: string, telefone: string|null}|null>}
 */
async function buscarCadastroPorCpf(cpf, dataIso, empresaId) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  if (cpfLimpo.length !== 11 || !dataIso || !empresaId) return null;
  const [[row]] = await db.execute(
    `SELECT nome, telefone FROM leads
     WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ? AND empresa_id = ? AND data_nascimento = ?
       AND nome IS NOT NULL AND nome <> ''
     ORDER BY criado_em DESC LIMIT 1`,
    [cpfLimpo, empresaId, dataIso]
  );
  return row || null;
}

const normMac = (m) => String(m || "").toLowerCase().replace(/[^0-9a-f]/g, "");

/**
 * Indica se o MAC da requisicao e' o mesmo guardado no lead (mesmo aparelho de antes).
 * @param {{mac?: string}|null} lead
 * @param {string} mac
 */
function mesmoDispositivo(lead, mac) {
  const a = normMac(lead && lead.mac);
  return a.length === 12 && a === normMac(mac);
}

/**
 * Grava a data de nascimento no lead desse CPF/empresa (best-effort: nunca lanca;
 * se a migration 026 ainda nao rodou ou a data for invalida, apenas ignora).
 *
 * Anti-sequestro (o cadastro e' publico: qualquer um pode digitar o CPF de outra pessoa):
 *  - nunca sobrescreve uma data ja gravada (so preenche quando esta NULL);
 *  - so grava em lead recem-criado (ultimos 5 min) ou, com permitirLeadExistente,
 *    quando a requisicao vem do mesmo aparelho (MAC) do cadastro anterior.
 * Assim ninguem "assume" o cadastro de um CPF alheio para depois le-lo pela busca.
 * @param {string} cpf
 * @param {number|null} empresaId
 * @param {*} data - 'AAAA-MM-DD' ou 'DD/MM/AAAA'
 * @param {{permitirLeadExistente?: boolean}} [opcoes]
 */
async function gravarDataNascimento(cpf, empresaId, data, { permitirLeadExistente = false } = {}) {
  try {
    const dataIso = normalizarDataNascimento(data);
    const cpfLimpo = String(cpf || "").replace(/\D/g, "");
    if (!dataIso || cpfLimpo.length !== 11 || !empresaId) return;
    const janela = permitirLeadExistente ? "" : " AND criado_em >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)";
    await db.execute(
      `UPDATE leads SET data_nascimento = ?
       WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ? AND empresa_id = ? AND data_nascimento IS NULL${janela}`,
      [dataIso, cpfLimpo, empresaId]
    );
  } catch (err) {
    console.warn("[gravarDataNascimento] ignorado:", err.message);
  }
}

/**
 * Segundo fator da reconexao por CPF: confere a data de nascimento informada com a
 * gravada no(s) lead(s) desse CPF/empresa (comparacao feita no SQL, sem fuso).
 * Resultados:
 *  - 'ok'         data bate;
 *  - 'ausente'    cadastro sem data gravada (legado): nao ha como verificar;
 *  - 'divergente' ha data gravada e a informada falta ou nao bate (conta como tentativa errada);
 *  - 'bloqueado'  tentativas erradas demais (CPF ou dispositivo): nem consulta.
 * @param {string} cpf
 * @param {number|null} empresaId
 * @param {*} data - 'AAAA-MM-DD' ou 'DD/MM/AAAA'
 * @param {{mac?: string, ip?: string}} [origem]
 */
async function conferirDataNascimento(cpf, empresaId, data, { mac, ip } = {}) {
  const ctx = { empresaId, cpf, ip, mac };
  if (dobTentativas.bloqueado(ctx)) return "bloqueado";
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  const dataIso = normalizarDataNascimento(data);
  let total = 0;
  let iguais = 0;
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS total, COALESCE(SUM(data_nascimento = ?), 0) AS iguais
       FROM leads
       WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ? AND data_nascimento IS NOT NULL${empresaId ? " AND empresa_id = ?" : ""}`,
      empresaId ? [dataIso || "0000-00-00", cpfLimpo, empresaId] : [dataIso || "0000-00-00", cpfLimpo]
    );
    total = Number(row?.total) || 0;
    iguais = Number(row?.iguais) || 0;
  } catch (err) {
    // Ex.: migration 026 ainda nao rodou (sem coluna = nenhuma data gravada)
    console.warn("[conferirDataNascimento] indisponivel:", err.message);
    return "ausente";
  }
  if (total === 0) return "ausente";
  if (dataIso && iguais > 0) return "ok";
  dobTentativas.registrarFalha(ctx);
  return "divergente";
}

/**
 * O username RADIUS (telefone limpo, e-mail ou MAC) pertence a este lead? Evita que quem
 * tem um CPF+data validos peca as credenciais do username (telefone) de outra pessoa.
 * @param {{telefone?: string, email?: string, mac?: string}|null} lead
 * @param {string} username
 */
function usernamePertenceAoLead(lead, username) {
  if (!lead || !username) return false;
  const u = String(username).toLowerCase();
  const tel = String(lead.telefone || "").replace(/\D/g, "");
  return [tel, String(lead.email || "").toLowerCase(), String(lead.mac || "").toLowerCase()]
    .filter(Boolean)
    .includes(u);
}

/**
 * Calcula o saldo de tempo RADIUS de um usuario (modelo cumulativo).
 * Soma o tempo consumido (acctsessiontime + tempo vivo se sessao aberta)
 * de TODO o historico do radacct e compara com Max-All-Session do radcheck.
 * Bate com o sqlcounter 'totalcounter' do FreeRADIUS (reset=never).
 * @param {string} username - username RADIUS (tipicamente CPF limpo)
 * @returns {Object} { existe, temSaldo, password, maxSession, tempoUsado, tempoRestante }
 */
async function verificarSaldoRadius(username) {
  if (!username) return { existe: false, temSaldo: false, tempoRestante: 0 };

  const [radcheckRows] = await db.query(
    "SELECT attribute, value FROM radcheck WHERE username = ?",
    [username]
  );

  if (radcheckRows.length === 0) {
    return { existe: false, temSaldo: false, tempoRestante: 0 };
  }

  const maxSessionRow = radcheckRows.find(r => r.attribute === "Max-All-Session");
  const passwordRow = radcheckRows.find(r => r.attribute === "Cleartext-Password");
  const maxSession = maxSessionRow ? parseInt(maxSessionRow.value) : 0;
  const password = passwordRow ? passwordRow.value : username;

  // IMPORTANTE: espelha o sqlcounter 'totalcounter' do FreeRADIUS, que soma apenas
  // sessoes com acctstarttime >= liberado_em (reset por timestamp da Fase 1.1).
  // Sem esse filtro, o backend somaria TODO o historico do radacct (que nao e mais
  // apagado nas liberacoes) e reportaria "sem saldo" pra clientes que o FreeRADIUS
  // ainda considera com tempo — bloqueando reconexao de quem tem saldo.
  const [[acctResult]] = await db.query(
    `SELECT COALESCE(SUM(
       IF(acctstoptime IS NULL,
          UNIX_TIMESTAMP() - UNIX_TIMESTAMP(acctstarttime),
          acctsessiontime)
     ), 0) AS usado
     FROM radacct
     WHERE username = ?
       AND acctstarttime >= COALESCE(
         (SELECT MAX(liberado_em) FROM radius_users WHERE username = ?),
         '1970-01-01 00:00:00')`,
    [username, username]
  );
  const tempoUsado = acctResult.usado || 0;
  const temSaldo = maxSession > 0 && tempoUsado < maxSession;

  return {
    existe: true,
    temSaldo,
    password,
    maxSession,
    tempoUsado,
    tempoRestante: temSaldo ? maxSession - tempoUsado : 0,
  };
}

/**
 * Atualiza (re-registra) um lead existente com novos dados e, opcionalmente,
 * um novo aceite LGPD. Cada reconexao gera um novo consentimento LGPD valido
 * (timestamp atualizado). Preserva isolamento multi-tenant filtrando por empresa_id.
 * @param {number} leadId
 * @param {number|null} empresaId
 * @param {Object} dados - { nome, email, telefone, mac, ip, aceite, termo }
 */
async function atualizarLeadExistente(leadId, empresaId, dados = {}) {
  const { nome, email, telefone, mac, ip, aceite, termo, ap_mac, ssid } = dados;

  const sets = [
    "nome = COALESCE(?, nome)",
    "email = COALESCE(?, email)",
    "telefone = COALESCE(?, telefone)",
    "mac = COALESCE(?, mac)",
    "ip = COALESCE(?, ip)",
    "ap_mac = COALESCE(?, ap_mac)",
    "ssid = COALESCE(?, ssid)",
  ];
  const params = [nome || null, email || null, telefone || null, mac || null, ip || null, ap_mac || null, ssid || null];

  // Novo aceite LGPD registrado (novo consentimento com timestamp valido).
  // O snapshot do termo acompanha o aceite (prova de QUAL texto foi aceito).
  if (aceite !== undefined) {
    sets.push("lgpd_aceite = ?", "lgpd_aceite_em = NOW()");
    params.push(aceite ? 1 : 0);
    if (termo) {
      sets.push("lgpd_termo = ?");
      params.push(termo);
    }
  }

  let query = `UPDATE leads SET ${sets.join(", ")} WHERE id = ?`;
  params.push(leadId);
  if (empresaId) {
    query += " AND empresa_id = ?";
    params.push(empresaId);
  }

  await db.execute(query, params);
}

// Mesmo default exibido no portal quando o admin nao customizou (PortalEditor/CadastroLGPD)
const TEXTO_LGPD_DEFAULT = "Aceito os termos da Lei Geral de Proteção de Dados (LGPD) e autorizo o tratamento dos meus dados pessoais, incluindo a data de nascimento, que será utilizada para confirmar minha identidade e recuperar meu cadastro. *";

/**
 * Busca a configuracao (JSON de portais.configuracoes) do portal que atende o cliente.
 * Ordem: portal_id explicito -> portal vinculado ao equipamento (mikrotiks.portal_id) ->
 * portal do tipo na empresa. Nunca lanca: sem portal ou com JSON ruim devolve null.
 * @param {Object} p - { portalId, mikrotikId, empresaId, tipoPortal }
 * @returns {Promise<Object|null>}
 */
async function resolverConfigPortal({ portalId, mikrotikId, empresaId, tipoPortal = "lgpd" } = {}) {
  try {
    let portal = null;
    if (portalId) {
      // portal_id pode vir de request publica: filtra por empresa quando
      // conhecida, senao o snapshot do termo (prova LGPD) poderia ser o texto
      // de OUTRA empresa. Sem match, cai nos fallbacks abaixo.
      if (empresaId) {
        [[portal]] = await db.execute(
          "SELECT configuracoes FROM portais WHERE id = ? AND empresa_id = ?",
          [portalId, empresaId]
        );
      } else {
        [[portal]] = await db.execute("SELECT configuracoes FROM portais WHERE id = ?", [portalId]);
      }
    }
    if (!portal && mikrotikId) {
      [[portal]] = await db.execute(
        "SELECT p.configuracoes FROM portais p JOIN mikrotiks m ON m.portal_id = p.id WHERE m.id = ?",
        [mikrotikId]
      );
    }
    if (!portal && empresaId) {
      [[portal]] = await db.execute(
        "SELECT configuracoes FROM portais WHERE tipo = ? AND empresa_id = ? LIMIT 1",
        [tipoPortal, empresaId]
      );
    }
    if (portal?.configuracoes) {
      const cfg = typeof portal.configuracoes === "string" ? JSON.parse(portal.configuracoes) : portal.configuracoes;
      return cfg && typeof cfg === "object" ? cfg : null;
    }
  } catch (err) {
    console.warn("[resolverConfigPortal] sem config do portal:", err.message);
  }
  return null;
}

/**
 * Resolve o texto do termo LGPD exibido no portal, pra guardar como snapshot
 * no aceite (leads.lgpd_termo). Nunca lanca erro (prova de consentimento nao
 * pode bloquear a liberacao): sem texto customizado cai no default.
 * @param {Object} p - { portalId, mikrotikId, empresaId, tipoPortal }
 * @returns {Promise<string>}
 */
async function resolverTextoLgpd(p = {}) {
  const cfg = await resolverConfigPortal(p);
  if (cfg?.texto_lgpd) return String(cfg.texto_lgpd);
  return TEXTO_LGPD_DEFAULT;
}

/**
 * Campos do formulario (visivel/obrigatorio) do portal que atende o cliente.
 * Nunca lanca: sem config ou com config ruim devolve os padroes.
 * @param {Object} p - { portalId, mikrotikId, empresaId, tipoPortal }
 */
async function resolverCamposPortal(p = {}) {
  const cfg = await resolverConfigPortal(p);
  return normalizarCampos(cfg?.campos);
}

module.exports = { verificarLeadExistente, buscarCadastroPorCpf, gravarDataNascimento, mesmoDispositivo, verificarSaldoRadius, conferirDataNascimento, usernamePertenceAoLead, atualizarLeadExistente, resolverTextoLgpd, resolverConfigPortal, resolverCamposPortal, TEXTO_LGPD_DEFAULT };
