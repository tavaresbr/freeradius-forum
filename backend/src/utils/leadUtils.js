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
 * @returns {Promise<{nome: string, telefone: string|null, email: string|null}|null>}
 */
async function buscarCadastroPorCpf(cpf, dataIso, empresaId) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  if (cpfLimpo.length !== 11 || !dataIso || !empresaId) return null;
  const [[row]] = await db.execute(
    `SELECT nome, telefone, email FROM leads
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
 * O CPF ja foi "confirmado" por dinheiro: existe pagamento aprovado (ou ja expirado) com esse
 * CPF na empresa. Sem isso o cadastro e' provisorio — qualquer um pode digitar o CPF de outra
 * pessoa antes dela (grilagem), entao a data de nascimento gravada nao prova titularidade e nao
 * pode trancar o dono de verdade para fora. Na duvida (erro de banco) considera confirmado:
 * a trava rigida e' o lado seguro.
 * @param {string} cpfLimpo - 11 digitos
 * @param {number|null} empresaId
 * @returns {Promise<boolean>}
 */
async function cpfConfirmado(cpfLimpo, empresaId) {
  try {
    const [rows] = await db.execute(
      `SELECT 1 FROM pagamentos
        WHERE status IN ('approved', 'expirado')
          AND REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = ?${empresaId ? " AND empresa_id = ?" : ""}
        LIMIT 1`,
      empresaId ? [cpfLimpo, empresaId] : [cpfLimpo]
    );
    return rows.length > 0;
  } catch (err) {
    console.warn("[cpfConfirmado] indisponivel:", err.message);
    return true;
  }
}

/**
 * Segundo fator da reconexao por CPF: confere a data de nascimento informada com a
 * gravada no(s) lead(s) desse CPF/empresa (comparacao feita no SQL, sem fuso).
 * Resultados:
 *  - 'ok'          data bate;
 *  - 'ausente'     cadastro sem data gravada (legado): nao ha como verificar;
 *  - 'divergente'  ha data gravada e a informada falta ou nao bate (conta como tentativa errada);
 *  - 'reivindicado' o CPF NAO esta confirmado por pagamento (ver cpfConfirmado) e o chamador
 *                  informou outra data: ela substitui a gravada (ultimo a se cadastrar fica com o
 *                  cadastro provisorio) e conta como tentativa. NAO prova titularidade: o chamador
 *                  nunca devolve credenciais existentes nesse caso. Com `reivindicarAusente`, o
 *                  cadastro sem data tambem e' reivindicado (grava a data, se informada);
 *  - 'bloqueado'   tentativas erradas demais (CPF ou dispositivo): nem consulta.
 * @param {string} cpf
 * @param {number|null} empresaId
 * @param {*} data - 'AAAA-MM-DD' ou 'DD/MM/AAAA'
 * @param {{mac?: string, ip?: string, reivindicarAusente?: boolean}} [origem]
 */
async function conferirDataNascimento(cpf, empresaId, data, { mac, ip, reivindicarAusente = false } = {}) {
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

  const reivindicar = async () => {
    try {
      if (dataIso) {
        await db.execute(
          `UPDATE leads SET data_nascimento = ?
            WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ?${empresaId ? " AND empresa_id = ?" : ""}`,
          empresaId ? [dataIso, cpfLimpo, empresaId] : [dataIso, cpfLimpo]
        );
      }
    } catch (err) {
      console.warn("[reivindicacao-cpf] nao gravou a data:", err.message);
    }
    dobTentativas.registrarFalha(ctx); // limita a troca de dono do cadastro provisorio
    console.warn(`[reivindicacao-cpf] empresa=${empresaId || "-"} ip=${ip || "-"}`); // nunca loga CPF
    return "reivindicado";
  };

  if (total === 0) {
    if (reivindicarAusente && !(await cpfConfirmado(cpfLimpo, empresaId))) return reivindicar();
    return "ausente";
  }
  if (dataIso && iguais > 0) return "ok";
  if (dataIso && !(await cpfConfirmado(cpfLimpo, empresaId))) return reivindicar();
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
 * Pagamento para o CPF de OUTRA pessoa: o username RADIUS e' o CPF, entao pagar por ele
 * troca a senha dele e (com empilhamento) funde o tempo restante do titular na conta de quem
 * pagou. As rotas de pagamento sao publicas e aceitam `cpf`/`cliente_id` do corpo, entao nao
 * da pra confiar no cadastro anterior. Regra: se o CPF ja tem acesso ATIVO no RADIUS, so quem
 * esta no mesmo aparelho (MAC) registrado no lead desse CPF pode pagar; de outro aparelho
 * precisa antes confirmar a data de nascimento no cadastro (que passa o MAC do lead para o
 * aparelho novo). Sem acesso ativo nao ha o que proteger. Sem CPF o username e' o proprio MAC.
 * @param {{cpf: string, mac: string, empresaId: number|null}} p
 * @returns {Promise<boolean>} true = deve recusar o pagamento (antes de cobrar)
 */
async function bloqueiaPagamentoAlheio({ cpf, mac, empresaId }) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  if (cpfLimpo.length !== 11) return false;
  const saldo = await verificarSaldoRadius(cpfLimpo);
  if (!(saldo.existe && saldo.temSaldo)) return false;
  let query = "SELECT mac FROM leads WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = ?";
  const params = [cpfLimpo];
  if (empresaId) {
    query += " AND empresa_id = ?";
    params.push(empresaId);
  }
  const [rows] = await db.execute(query, params);
  return !rows.some((r) => mesmoDispositivo(r, mac));
}

const MSG_PAGAMENTO_ALHEIO = "Já existe um acesso ativo para este CPF em outro aparelho. Volte ao cadastro e informe a data de nascimento do titular, ou use o usuário e senha que você recebeu.";

/**
 * Este aparelho (MAC) ja usou o acesso desse username? Prova de posse do acesso: existe
 * sessao no radacct do username vinda desse MAC. Quem so digitou CPF + uma data que ele mesmo
 * gravou (cadastro provisorio) nunca conectou com aquele username.
 * @param {string} username
 * @param {string} mac
 * @returns {Promise<boolean>}
 */
async function dispositivoJaUsouAcesso(username, mac) {
  const macLimpo = normMac(mac);
  if (!username || macLimpo.length !== 12) return false;
  try {
    const [rows] = await db.execute(
      `SELECT 1 FROM radacct
        WHERE username = ? AND LOWER(REPLACE(REPLACE(callingstationid, '-', ''), ':', '')) = ?
        LIMIT 1`,
      [username, macLimpo]
    );
    return rows.length > 0;
  } catch (err) {
    console.warn("[dispositivoJaUsouAcesso] indisponivel:", err.message);
    return false;
  }
}

/**
 * O acesso ativo desse username e' do plano GRATIS dos portais (LGPD / Lead)? So esse pode ser
 * regravado por quem nao se provou: acesso pago (CPF confirmado) ou criado pelo admin (outro
 * plano, ou sem registro em radius_users) continua protegido.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
async function acessoEhGratis(username) {
  try {
    const [[row]] = await db.execute(
      `SELECT p.nome FROM radius_users ru JOIN planos p ON p.id = ru.plano_id WHERE ru.username = ? LIMIT 1`,
      [username]
    );
    return !!row && ["lgpd", "lead"].includes(String(row.nome || "").trim().toLowerCase());
  } catch (err) {
    console.warn("[acessoEhGratis] indisponivel:", err.message);
    return false;
  }
}

/**
 * Pode devolver as credenciais de um acesso JA existente a quem passou na checagem da data de
 * nascimento? Se o CPF e' confirmado por pagamento, a data e' trava rigida (basta). Em cadastro
 * provisorio (sem pagamento) a data nao prova nada — qualquer um a grava ao reivindicar o CPF e
 * volta com ela —, entao so o aparelho que ja usou o acesso recebe as credenciais de volta;
 * os demais caem na re-liberacao (senha nova), que nao expoe nada do acesso anterior.
 * @param {{cpf: string, username: string, mac: string, empresaId: number|null}} p
 * @returns {Promise<boolean>}
 */
async function podeReceberCredenciais({ cpf, username, mac, empresaId }) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  if (cpfLimpo.length === 11 && (await cpfConfirmado(cpfLimpo, empresaId))) return true;
  return dispositivoJaUsouAcesso(username, mac);
}

/**
 * A re-liberacao (DELETE + INSERT no radcheck/radreply/radusergroup do username) troca a
 * senha e o plano. Para um username que JA tem saldo ativo isso destroi o acesso de quem
 * pode ser outra pessoa (ex.: plano pago sobrescrito pelo plano gratis de quem so sabe o CPF).
 * So permite quando o titular foi verificado (data de nascimento) ou o username e' o proprio
 * MAC do aparelho; sem saldo ativo nao ha o que proteger (renovar a franquia esgotada segue livre).
 * @param {{username: string, titularVerificado?: boolean, usernameEhMac?: boolean}} p
 * @returns {Promise<boolean>} true = deve recusar a re-liberacao
 */
async function bloqueiaReliberacao({ username, titularVerificado = false, usernameEhMac = false }) {
  if (titularVerificado || usernameEhMac || !username) return false;
  const saldo = await verificarSaldoRadius(username);
  if (!(saldo.existe && saldo.temSaldo)) return false;
  // Acesso gratis (plano LGPD/Lead) pode ser regravado: nao ha o que proteger e trancar o dono
  // (que nunca conectou) so deixaria o acesso parado. Acesso pago/admin continua protegido.
  return !(await acessoEhGratis(username));
}

const MSG_ACESSO_ATIVO = "Já existe um acesso ativo para este cadastro. Use o usuário e senha que você recebeu ou informe a data de nascimento do titular.";

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

module.exports = { verificarLeadExistente, buscarCadastroPorCpf, gravarDataNascimento, mesmoDispositivo, verificarSaldoRadius, conferirDataNascimento, cpfConfirmado, dispositivoJaUsouAcesso, acessoEhGratis, podeReceberCredenciais, usernamePertenceAoLead, bloqueiaReliberacao, MSG_ACESSO_ATIVO, bloqueiaPagamentoAlheio, MSG_PAGAMENTO_ALHEIO, atualizarLeadExistente, resolverTextoLgpd, resolverConfigPortal, resolverCamposPortal, TEXTO_LGPD_DEFAULT };
