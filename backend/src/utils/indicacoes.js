// Indicacoes (cliente indica cliente): config, codigo e a decisao antifraude. Funcoes puras, sem banco.
const crypto = require("node:crypto");

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I/L
const MAX_MSG = 1000;

const MSG_CONVITE = "Olá, {{nome}}! Indique a {{empresa}} a um amigo: ele ganha desconto na primeira compra usando o código {{codigo}} e você ganha um cupom quando ele comprar. Link: {{link}}";
const MSG_RECOMPENSA = "🎉 Seu amigo comprou com o seu código! Seu cupom {{codigo}} vale {{desconto}} na próxima compra (válido até {{validade}}). {{link}}";

const padrao = () => ({
  ativo: false,
  desconto_indicado: { tipo: "percentual", valor: 10 },
  recompensa_indicador: { tipo: "percentual", valor: 10 },
  validade_cupom_dias: 30,
  limite_por_indicador_mes: 5,
  exigir_compra_do_indicador: true,
  mensagem_convite: MSG_CONVITE,
});

function validarDesconto(d, nome) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const tipo = d?.tipo;
  const valor = Number(d?.valor);
  if (tipo !== "percentual" && tipo !== "valor") throw erro(`${nome}: tipo inválido`);
  if (!Number.isInteger(valor) || valor < 1) throw erro(`${nome}: informe o valor`);
  if (tipo === "percentual" && valor > 99) throw erro(`${nome}: o percentual vai de 1% a 99%`);
  if (tipo === "valor" && valor > 1000000) throw erro(`${nome}: valor muito alto`);
  return { tipo, valor };
}

/** Valida o corpo do admin. Lanca Error com .status = 400. */
function validarConfig(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  const validade = b.validade_cupom_dias === undefined || b.validade_cupom_dias === "" ? 30 : Number(b.validade_cupom_dias);
  if (!Number.isInteger(validade) || validade < 1 || validade > 365) throw erro("Validade do cupom: 1 a 365 dias");
  const limite = b.limite_por_indicador_mes === undefined || b.limite_por_indicador_mes === "" ? 5 : Number(b.limite_por_indicador_mes);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw erro("Limite por indicador: 1 a 100 por mês");
  const msg = typeof b.mensagem_convite === "string" ? b.mensagem_convite.trim() : "";
  if (msg.length > MAX_MSG) throw erro(`Mensagem: máximo ${MAX_MSG} caracteres`);
  const mensagem_convite = msg || MSG_CONVITE;
  if (!/\{\{\s*codigo\s*\}\}/i.test(mensagem_convite)) throw erro("A mensagem precisa conter {{codigo}}");
  return {
    ativo: !!b.ativo,
    desconto_indicado: validarDesconto(b.desconto_indicado, "Desconto do indicado"),
    recompensa_indicador: validarDesconto(b.recompensa_indicador, "Recompensa do indicador"),
    validade_cupom_dias: validade,
    limite_por_indicador_mes: limite,
    exigir_compra_do_indicador: b.exigir_compra_do_indicador !== false,
    mensagem_convite,
  };
}

const mesclarComPadrao = (salva) => {
  const p = padrao();
  const s = salva && typeof salva === "object" ? salva : {};
  return { ...p, ...s, desconto_indicado: { ...p.desconto_indicado, ...(s.desconto_indicado || {}) }, recompensa_indicador: { ...p.recompensa_indicador, ...(s.recompensa_indicador || {}) } };
};

/** Codigo do cliente: IND + 6 caracteres (passa no formato dos cupons [A-Z0-9]{3,32}). */
function gerarCodigo(bytes = crypto.randomBytes) {
  const b = bytes(6);
  let s = "IND";
  for (let i = 0; i < 6; i++) s += ALFABETO[b[i] % ALFABETO.length];
  return s;
}

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const fim10 = (v) => digitos(v).slice(-10);
const macLimpo = (v) => String(v ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();

/**
 * Decisao antifraude (pura). Recusa com um `motivo` interno (nunca mostrado ao cliente: a resposta publica e' a mesma
 * de cupom invalido). Regras: so a 1a compra do CPF; nunca o proprio indicador (CPF, telefone ou aparelho);
 * 1 indicacao por CPF; teto mensal por indicador; indicador precisa ser cliente (se exigido).
 */
function decidirIndicacao({ cfg, indicador, indicado, jaComprou, jaIndicado, usadasMes, indicadorEhCliente }) {
  if (!cfg?.ativo) return { ok: false, motivo: "programa_desligado" };
  if (digitos(indicado.cpf).length !== 11) return { ok: false, motivo: "sem_cpf" };
  if (jaComprou) return { ok: false, motivo: "nao_e_primeira_compra" };
  if (jaIndicado) return { ok: false, motivo: "cpf_ja_indicado" };
  if (digitos(indicador.cpf) && digitos(indicador.cpf) === digitos(indicado.cpf)) return { ok: false, motivo: "auto_indicacao_cpf" };
  if (fim10(indicador.telefone).length === 10 && fim10(indicador.telefone) === fim10(indicado.telefone)) return { ok: false, motivo: "auto_indicacao_telefone" };
  if (macLimpo(indicador.mac).length === 12 && macLimpo(indicador.mac) === macLimpo(indicado.mac)) return { ok: false, motivo: "auto_indicacao_aparelho" };
  if (cfg.exigir_compra_do_indicador && !indicadorEhCliente) return { ok: false, motivo: "indicador_sem_compra" };
  if (Number(usadasMes) >= Number(cfg.limite_por_indicador_mes)) return { ok: false, motivo: "limite_mensal" };
  return { ok: true };
}

const mascararCpf = (cpf) => { const d = digitos(cpf); return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : ""; };

module.exports = { MSG_CONVITE, MSG_RECOMPENSA, padrao, validarConfig, mesclarComPadrao, gerarCodigo, decidirIndicacao, mascararCpf, digitos };
