// Le contatos exportados do Google Contatos ou do Outlook (CSV ou vCard .vcf) e devolve {nome, telefone, email}.
const { parseCsv } = require("./importCadastros");
const { normalizarTelefone } = require("../services/whatsappNotify");
const { MAX_CONTATOS } = require("./whatsappContatos");

const norm = (h) => String(h || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function montar(brutos) {
  const vistos = new Set();
  const contatos = [];
  let invalidos = 0;
  for (const b of brutos) {
    const tel = (b.telefones || []).map(normalizarTelefone).find(Boolean);
    if (!tel) { invalidos++; continue; }
    if (vistos.has(tel)) continue;
    vistos.add(tel);
    const email = (b.email || "").trim().slice(0, 150) || null;
    const nome = String(b.nome || "").replace(/\s+/g, " ").trim().slice(0, 150);
    contatos.push({ telefone: tel, email, nome: nome || `Contato ${tel.slice(-4)}` });
    if (contatos.length >= MAX_CONTATOS) break;
  }
  return { contatos, invalidos };
}

function lerCsv(buffer) {
  const { cabecalhos, linhas } = parseCsv(buffer);
  const cols = (re) => cabecalhos.filter((h) => re.test(norm(h)));
  const nomeCols = cols(/^(firstname|givenname|primeironome|nome)$/);
  const sobrenomeCols = cols(/^(lastname|familyname|sobrenome)$/);
  const nomeCompleto = cols(/^(name|nomecompleto|displayname)$/);
  const telCols = cols(/^(phone\d*value|telefone\d*valor|phone\d*number|mobilephone|primaryphone|homephone|businessphone|otherphone|celular|telefone|telefonecelular|telefoneresidencial|telefonecomercial|telefoneprincipal|outrotelefone)$/);
  const emailCols = cols(/^(email\d*value|email\d*valor|emailaddress|email1address|enderecodeemail|enderecodeemail1|email)$/);
  if (!telCols.length) throw new Error("Não encontrei coluna de telefone no arquivo (use a exportação CSV do Google Contatos ou do Outlook)");
  const brutos = linhas.map((l) => {
    const nome = nomeCompleto.map((h) => l[h]).find(Boolean)
      || [...nomeCols, ...sobrenomeCols].map((h) => l[h]).filter(Boolean).join(" ");
    // Google junta varios numeros do mesmo valor com " ::: "
    const telefones = telCols.flatMap((h) => String(l[h] || "").split(":::"));
    return { nome, telefones, email: emailCols.map((h) => l[h]).find(Boolean) };
  });
  return montar(brutos);
}

function lerVcf(buffer) {
  const texto = buffer.toString("utf8").replace(/\r?\n[ \t]/g, ""); // desdobra linhas longas
  const brutos = [];
  for (const bloco of texto.split(/BEGIN:VCARD/i).slice(1)) {
    const c = { telefones: [] };
    for (const linha of bloco.split(/\r?\n/)) {
      const [chave, ...resto] = linha.split(":");
      const valor = resto.join(":").trim();
      const campo = chave.split(";")[0].toUpperCase();
      if (campo === "FN" && !c.nome) c.nome = valor;
      else if (campo === "TEL" && valor) c.telefones.push(valor);
      else if (campo === "EMAIL" && !c.email) c.email = valor;
    }
    brutos.push(c);
  }
  return montar(brutos);
}

function lerContatosGoogle(buffer, nomeArquivo) {
  const ext = String(nomeArquivo || "").toLowerCase().split(".").pop();
  return ext === "vcf" ? lerVcf(buffer) : lerCsv(buffer);
}

module.exports = { lerContatosGoogle };
