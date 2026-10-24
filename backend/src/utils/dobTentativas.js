const crypto = require("crypto");

// Limita tentativas ERRADAS de data de nascimento nas rotas de reconexao
// (anti-adivinhacao do segundo fator). Memoria do processo: zera se o PM2 reiniciar.
// Duas travas: por CPF (empresa+cpf, hash) e por dispositivo (ip+mac).
const JANELA_MS = 60 * 60 * 1000;
const LIMITE = 10;
const falhas = new Map(); // chave -> { n, expira }

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

function chaves({ empresaId, cpf, ip, mac }) {
  const cpfLimpo = String(cpf || "").replace(/\D/g, "");
  const macLimpo = String(mac || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return [`cpf:${hash(`${empresaId || 0}|${cpfLimpo}`)}`, `dev:${ip || "-"}|${macLimpo}`];
}

function limpar(agora) {
  if (falhas.size < 5000) return;
  for (const [k, v] of falhas) if (v.expira <= agora) falhas.delete(k);
}

function bloqueado(ctx, agora = Date.now()) {
  return chaves(ctx).some((k) => {
    const v = falhas.get(k);
    return v && v.expira > agora && v.n >= LIMITE;
  });
}

function registrarFalha(ctx, agora = Date.now()) {
  limpar(agora);
  for (const k of chaves(ctx)) {
    const v = falhas.get(k);
    if (v && v.expira > agora) v.n += 1;
    else falhas.set(k, { n: 1, expira: agora + JANELA_MS });
  }
}

function _resetar() { falhas.clear(); }

module.exports = { bloqueado, registrarFalha, LIMITE, _resetar };
