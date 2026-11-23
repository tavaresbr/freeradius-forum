// Resumo do uso da IA por empresa (tela /super/uso-ia). Funcoes puras.
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERTO_PCT = 80;

const mesValido = (m) => typeof m === "string" && MES_RE.test(m);

/** 'desligada' | 'esgotado' | 'perto' | 'ok'. `limite` null = ilimitado (nunca perto/esgotado). */
function statusDoUso({ iaAtiva, respostas, limite }) {
  const r = Number(respostas) || 0;
  if (!iaAtiva && r === 0) return "desligada";
  if (limite == null) return "ok";
  const l = Number(limite);
  if (r >= l) return "esgotado";
  return l > 0 && (r / l) * 100 >= PERTO_PCT ? "perto" : "ok";
}

/** Linha da tabela: calcula o percentual e o status. */
function montarLinha({ id, nome, plano, iaAtiva, respostas, limite, tokensIn, tokensOut }) {
  const r = Number(respostas) || 0;
  const lim = limite == null ? null : Number(limite);
  return {
    id, nome, plano: plano || null, ia_ativa: !!iaAtiva, respostas: r, limite: lim,
    pct: lim ? Math.min(100, Math.round((r / lim) * 100)) : null,
    tokens_in: Number(tokensIn) || 0, tokens_out: Number(tokensOut) || 0,
    status: statusDoUso({ iaAtiva, respostas: r, limite: lim }),
  };
}

function totais(linhas) {
  return linhas.reduce((t, l) => ({
    respostas: t.respostas + l.respostas,
    tokens_in: t.tokens_in + l.tokens_in,
    tokens_out: t.tokens_out + l.tokens_out,
    empresas_com_uso: t.empresas_com_uso + (l.respostas > 0 ? 1 : 0),
  }), { respostas: 0, tokens_in: 0, tokens_out: 0, empresas_com_uso: 0 });
}

module.exports = { mesValido, statusDoUso, montarLinha, totais, PERTO_PCT };
