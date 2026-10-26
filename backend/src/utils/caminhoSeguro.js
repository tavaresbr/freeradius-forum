"use strict";

const path = require("path");

/** Identificador de update/backup que vira nome de pasta ou parametro de URL: so letras, numeros, ponto, _ e -. */
function idSeguro(v) {
  const s = String(v == null ? "" : v);
  return /^[\w][\w.-]{0,63}$/.test(s) && !s.includes("..") ? s : null;
}

// Arquivos do projeto que um pacote de atualizacao nunca pode tocar (segredos e dados do tenant).
const PROTEGIDOS = [/^\.env(\.|$)/, /(^|\/)\.env(\.|$)/, /^backend\/certificados(\/|$)/, /^backend\/tokens(\/|$)/, /^backend\/uploads(\/|$)/, /(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/];
const EXTERNO_PERMITIDO = "/etc/freeradius/3.0/";

/**
 * Resolve o destino de um arquivo do pacote de atualizacao. Relativo: tem de ficar dentro de root.
 * "external:<abs>": so dentro de /etc/freeradius/3.0/. Qualquer outra coisa lanca erro.
 */
function resolverArquivoUpdate(root, caminho) {
  const bruto = String(caminho == null ? "" : caminho);
  if (!bruto || bruto.includes("\0")) throw new Error("Caminho inválido no pacote");
  if (bruto.startsWith("external:")) {
    const abs = path.posix.normalize(bruto.slice("external:".length));
    if (!abs.startsWith(EXTERNO_PERMITIDO) || abs.includes("..")) throw new Error("Destino externo não permitido no pacote");
    return { filePath: abs, isExternal: true };
  }
  if (path.isAbsolute(bruto)) throw new Error("Caminho absoluto não permitido no pacote");
  const rel = path.posix.normalize(bruto.replace(/\\/g, "/"));
  if (rel.startsWith("..") || rel === ".") throw new Error("Caminho fora do projeto no pacote");
  if (PROTEGIDOS.some((re) => re.test(rel))) throw new Error("Caminho protegido no pacote");
  const filePath = path.join(root, rel);
  if (!filePath.startsWith(path.resolve(root) + path.sep)) throw new Error("Caminho fora do projeto no pacote");
  return { filePath, isExternal: false };
}

module.exports = { idSeguro, resolverArquivoUpdate };
