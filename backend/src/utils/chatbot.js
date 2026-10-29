// Chatbot de menu do atendimento WhatsApp: validacao da config e interpretacao da mensagem. Funcoes puras, sem banco.
const TIPOS = ["saldo", "planos", "atendente", "texto"];
const MAX_OPCOES = 9;
const MAX_ROTULO = 60;
const MAX_TEXTO = 500;
const MAX_MSG = 600;

const MENU_PADRAO = "Olá{{nome}}! Como posso ajudar?";
const padrao = () => ({
  ativo: false,
  mensagem_menu: MENU_PADRAO,
  msg_atendente: "Certo! Um atendente vai responder você em breve.",
  opcoes: [
    { tecla: "1", rotulo: "Ver meu tempo restante", tipo: "saldo", texto: "" },
    { tecla: "2", rotulo: "Ver os planos", tipo: "planos", texto: "" },
    { tecla: "3", rotulo: "Falar com um atendente", tipo: "atendente", texto: "" },
  ],
});

function validarChatbot(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const txt = (v, max, nome) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > max) throw erro(`${nome}: máximo ${max} caracteres`);
    return t;
  };
  const brutas = Array.isArray(b.opcoes) ? b.opcoes : [];
  if (brutas.length > MAX_OPCOES) throw erro(`Máximo de ${MAX_OPCOES} opções`);
  const teclas = new Set();
  const opcoes = brutas.map((o) => {
    const tecla = String(o?.tecla ?? "").trim();
    if (!/^[1-9]$/.test(tecla)) throw erro("A tecla de cada opção deve ser um número de 1 a 9");
    if (teclas.has(tecla)) throw erro(`A tecla ${tecla} está repetida`);
    teclas.add(tecla);
    const tipo = String(o?.tipo || "");
    if (!TIPOS.includes(tipo)) throw erro("Tipo de opção inválido");
    const rotulo = txt(o?.rotulo, MAX_ROTULO, "Nome da opção");
    if (!rotulo) throw erro(`A opção ${tecla} precisa de um nome`);
    const texto = txt(o?.texto, MAX_TEXTO, "Texto da opção");
    if (tipo === "texto" && !texto) throw erro(`A opção ${tecla} precisa do texto da resposta`);
    return { tecla, rotulo, tipo, texto: tipo === "texto" ? texto : "" };
  });
  const cfg = {
    ativo: !!b.ativo,
    mensagem_menu: txt(b.mensagem_menu, MAX_MSG, "Mensagem do menu"),
    msg_atendente: txt(b.msg_atendente, MAX_MSG, "Mensagem do atendente"),
    opcoes: opcoes.sort((x, y) => x.tecla.localeCompare(y.tecla)),
  };
  if (cfg.ativo && !cfg.opcoes.length) throw erro("Cadastre ao menos uma opção para ligar o chatbot");
  if (cfg.ativo && !cfg.mensagem_menu) throw erro("Escreva a mensagem do menu");
  return cfg;
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

/** {{nome}} vira " Maria" (com espaco) ou vazio: "Olá{{nome}}!" -> "Olá Maria!" / "Olá!". */
const comNome = (modelo, nome) => {
  const primeiro = String(nome || "").trim().split(/\s+/)[0];
  return String(modelo || "").replace(/\{\{\s*nome\s*\}\}/gi, primeiro ? ` ${primeiro.slice(0, 40)}` : "").trim();
};

function montarMenu(cfg, nome) {
  const linhas = cfg.opcoes.map((o) => `${o.tecla} - ${o.rotulo}`).join("\n");
  return `${comNome(cfg.mensagem_menu, nome)}\n\n${linhas}\n\nResponda com o número da opção.`;
}

const semAcento = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** O que o cliente quis: { tipo:'opcao', opcao } | { tipo:'menu' } | { tipo:'livre' }. */
function interpretar(texto, cfg) {
  const t = semAcento(texto).replace(/[.!?\s]+$/g, "");
  if (/^[1-9]$/.test(t)) {
    const opcao = cfg.opcoes.find((o) => o.tecla === t);
    return opcao ? { tipo: "opcao", opcao } : { tipo: "livre" };
  }
  if (t === "menu" || t === "opcoes" || t === "ajuda") return { tipo: "menu" };
  return { tipo: "livre" };
}

module.exports = { TIPOS, MAX_OPCOES, padrao, validarChatbot, mesclarComPadrao, comNome, montarMenu, interpretar };
