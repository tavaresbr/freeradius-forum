// Exporta os clientes como lista de contatos para importar no Google Contatos, Outlook ou iCloud/celular (vCard).
// Funcoes puras: recebem as linhas de `leads` e devolvem o arquivo pronto.
const { normalizarTelefone } = require("../services/whatsappNotify");

const FORMATOS = {
  google: { arquivo: "contatos-google.csv", mime: "text/csv; charset=utf-8" },
  outlook: { arquivo: "contatos-outlook.csv", mime: "text/csv; charset=utf-8" },
  vcard: { arquivo: "contatos.vcf", mime: "text/vcard; charset=utf-8" },
};

// Dados de cliente podem comecar com = + - @ : neutraliza formula ao abrir no Excel
const cel = (v) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};
// Telefone ja e' normalizado por nos (+55...): nao pode virar "'+55" por causa da regra anti-formula
const tel = (v) => `"${String(v).replace(/"/g, '""')}"`;
// vCard 3.0: escapa \ ; , e quebra de linha
const vc = (v) => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\;").replace(/,/g, "\\,");

function separarNome(nome) {
  const partes = String(nome || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!partes.length) return { primeiro: "", resto: "" };
  return { primeiro: partes[0], resto: partes.slice(1).join(" ") };
}

// Telefone no formato internacional (+55DDDNUMERO); descarta o que nao for telefone valido e repetidos
function prepararContatos(rows) {
  const vistos = new Set();
  const contatos = [];
  let semTelefone = 0;
  for (const r of rows || []) {
    const tel = normalizarTelefone(r.telefone);
    if (!tel) { semTelefone++; continue; }
    if (vistos.has(tel)) continue;
    vistos.add(tel);
    const { primeiro, resto } = separarNome(r.nome);
    contatos.push({
      primeiro: primeiro || `Cliente ${tel.slice(-4)}`,
      resto,
      email: String(r.email || "").trim(),
      telefone: `+${tel}`,
    });
  }
  return { contatos, semTelefone };
}

function gerarContatos(rows, formato) {
  const def = FORMATOS[formato];
  if (!def) throw new Error("Formato inválido");
  const { contatos, semTelefone } = prepararContatos(rows);
  let conteudo;
  if (formato === "google") {
    const cab = "First Name,Last Name,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value";
    conteudo = "\uFEFF" + [cab, ...contatos.map((c) => [cel(c.primeiro), cel(c.resto), cel(c.email ? "Home" : ""), cel(c.email), cel("Mobile"), tel(c.telefone)].join(","))].join("\r\n") + "\r\n";
  } else if (formato === "outlook") {
    const cab = "First Name,Last Name,E-mail Address,Mobile Phone";
    conteudo = "\uFEFF" + [cab, ...contatos.map((c) => [cel(c.primeiro), cel(c.resto), cel(c.email), tel(c.telefone)].join(","))].join("\r\n") + "\r\n";
  } else {
    conteudo = contatos.map((c) => [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${vc(c.resto)};${vc(c.primeiro)};;;`,
      `FN:${vc([c.primeiro, c.resto].filter(Boolean).join(" "))}`,
      `TEL;TYPE=CELL:${c.telefone}`,
      ...(c.email ? [`EMAIL;TYPE=INTERNET:${vc(c.email)}`] : []),
      "END:VCARD",
    ].join("\r\n")).join("\r\n") + (contatos.length ? "\r\n" : "");
  }
  return { conteudo, mime: def.mime, arquivo: def.arquivo, total: contatos.length, semTelefone };
}

module.exports = { gerarContatos, prepararContatos, FORMATOS };
