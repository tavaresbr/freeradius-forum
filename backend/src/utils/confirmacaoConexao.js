// Mensagem de confirmacao ao conectar (credenciais/boas-vindas por WhatsApp apos liberar o acesso).
// Chave de liga/desliga da EMPRESA (vale para todos os portais) + trava anti-repeticao. Funcoes puras.
const MAX_HORAS = 168; // 7 dias
// Contextos de acesso gratis/recorrente (repetem a cada reconexao). Pagamento/upgrade nunca sao barrados pela trava:
// a mensagem leva a credencial que o cliente acabou de comprar.
const CONTEXTOS_REPETIVEIS = ["lgpd", "lead", "lead_passivo", "liberacao"];

const padrao = () => ({ ativo: true, nao_repetir_horas: 24 });

function validarConfirmacao(body) {
  const erro = (m) => Object.assign(new Error(m), { status: 400 });
  const b = body && typeof body === "object" ? body : {};
  if (typeof b.ativo !== "boolean") throw erro("Informe se a mensagem de confirmação fica ligada ou desligada");
  const horas = b.nao_repetir_horas === undefined || b.nao_repetir_horas === "" ? padrao().nao_repetir_horas : Number(b.nao_repetir_horas);
  if (!Number.isInteger(horas) || horas < 0 || horas > MAX_HORAS) throw erro(`"Não repetir por" deve ser de 0 a ${MAX_HORAS} horas (0 = sem trava)`);
  return { ativo: b.ativo, nao_repetir_horas: horas };
}

const mesclarComPadrao = (salva) => {
  const p = padrao();
  const s = salva && typeof salva === "object" ? salva : {};
  return {
    ativo: s.ativo === false ? false : true,
    nao_repetir_horas: Number.isInteger(s.nao_repetir_horas) && s.nao_repetir_horas >= 0 && s.nao_repetir_horas <= MAX_HORAS ? s.nao_repetir_horas : p.nao_repetir_horas,
  };
};

const contextoRepetivel = (ctx) => CONTEXTOS_REPETIVEIS.includes(String(ctx || ""));

module.exports = { MAX_HORAS, CONTEXTOS_REPETIVEIS, padrao, validarConfirmacao, mesclarComPadrao, contextoRepetivel };
