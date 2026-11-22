// Aviso ao proprietario de cliente esperando no chat: config e mensagem. Funcoes puras, sem banco.
const { normalizarTelefone } = require("../services/whatsappNotify");

const MAX_TELEFONES = 3;
const MIN_MINUTOS = 2;
const MAX_MINUTOS = 240;
const MAX_LISTA = 5; // conversas citadas na mensagem (o resto vira "+ N")

const padrao = () => ({ ativo: false, telefones: [], minutos: 10, somente_horario: false });

function validarAlertaEspera(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const brutos = Array.isArray(b.telefones) ? b.telefones : [];
  if (brutos.length > MAX_TELEFONES) throw erro(`Máximo de ${MAX_TELEFONES} telefones`);
  const telefones = [];
  for (const t of brutos) {
    if (String(t || "").trim() === "") continue;
    const n = normalizarTelefone(t);
    if (!n) throw erro("Telefone inválido. Use DDD + número.");
    if (!telefones.includes(n)) telefones.push(n);
  }
  const minutos = Number(b.minutos);
  if (!Number.isInteger(minutos) || minutos < MIN_MINUTOS || minutos > MAX_MINUTOS) throw erro(`Tempo de espera: entre ${MIN_MINUTOS} e ${MAX_MINUTOS} minutos`);
  if (b.ativo && !telefones.length) throw erro("Informe ao menos um telefone para receber os avisos");
  return { ativo: !!b.ativo, telefones, minutos, somente_horario: !!b.somente_horario };
}

const mesclarComPadrao = (salva) => ({ ...padrao(), ...(salva && typeof salva === "object" ? salva : {}) });

/** Nome do cliente ou os 4 ultimos digitos do telefone (nunca o numero inteiro nem o CPF). */
function rotulo(c) {
  const nome = String(c.nome || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (nome) return nome;
  const fim = String(c.telefone || "").replace(/\D/g, "").slice(-4);
  return fim ? `***${fim}` : "Cliente sem nome";
}

const duracao = (min) => (min >= 120 ? `${Math.floor(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/**
 * @param {{nome?: string, telefone?: string, espera_min: number}[]} itens ordenados do mais antigo para o mais novo
 * @param {string} link painel do atendimento (vazio = sem link)
 */
function montarMensagem(itens, link) {
  const total = itens.length;
  const linhas = itens.slice(0, MAX_LISTA).map((c) => `• ${rotulo(c)} — há ${duracao(c.espera_min)}`);
  const mais = total > MAX_LISTA ? `\n+ ${total - MAX_LISTA} outro(s)` : "";
  return `⏰ ${total === 1 ? "1 cliente esperando" : `${total} clientes esperando`} atendimento no chat:\n${linhas.join("\n")}${mais}${link ? `\n\nAbrir: ${link}` : ""}`;
}

module.exports = { MAX_TELEFONES, MIN_MINUTOS, MAX_MINUTOS, MAX_LISTA, padrao, validarAlertaEspera, mesclarComPadrao, rotulo, montarMensagem };
