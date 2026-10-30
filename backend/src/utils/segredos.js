/**
 * Segredos de configuracao (tokens de pagamento, chave da Evolution, senhas de gateway):
 * nunca voltam em texto puro para o navegador. A API devolve o valor mascarado ("abcd...") e,
 * ao salvar, um valor vazio ou ainda mascarado significa "manter o que ja esta gravado".
 */
const CAMPOS_SECRETOS = [
  "access_token", "client_secret", "webhook_secret", "api_key", "api_secret", "secret",
  "senha", "password", "api_pass", "gwn_api_key", "gwn_api_secret", "private_key", "token", "webhook_token",
];

const MARCA = "...";

const mascarar = (v) => {
  const s = v == null ? "" : String(v);
  if (!s) return "";
  return s.length <= 8 ? MARCA : `${s.slice(0, 4)}${MARCA}`;
};

const ehSegredo = (chave) => CAMPOS_SECRETOS.includes(String(chave).toLowerCase());

/** Copia rasa com os campos secretos mascarados (e `<campo>_definido` indicando se havia valor). */
function mascararObjeto(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ehSegredo(k)) {
      out[k] = mascarar(v);
      out[`${k}_definido`] = !!v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Valor enviado pelo cliente que significa "nao alterar" (vazio, ausente ou ainda mascarado). */
const semAlteracao = (v) => v === undefined || v === null || v === "" || (typeof v === "string" && v.endsWith(MARCA));

/** Aplica `novo` sobre `atual`, mantendo o segredo gravado quando o cliente nao enviou valor novo. */
function preservarSegredos(novo, atual) {
  const out = { ...(novo || {}) };
  for (const k of Object.keys(out)) {
    if (k.endsWith("_definido")) delete out[k];
  }
  for (const k of CAMPOS_SECRETOS) {
    if (k in out || (atual && k in atual)) {
      if (semAlteracao(out[k])) {
        if (atual && atual[k] !== undefined) out[k] = atual[k];
        else delete out[k];
      }
    }
  }
  return out;
}

module.exports = { CAMPOS_SECRETOS, mascarar, mascararObjeto, preservarSegredos, semAlteracao, ehSegredo };
