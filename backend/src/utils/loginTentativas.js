const crypto = require("crypto");

// Limita tentativas ERRADAS no login por usuario/senha do portal (/api/login-portal/auth).
// Memoria do processo: zera se o PM2 reiniciar. Duas travas:
//  - ip+usuario: 10/hora (quem erra a senha do mesmo usuario varias vezes);
//  - usuario (qualquer IP): 40/hora (adivinhacao distribuida), alto de proposito para um
//    atacante nao conseguir trancar o dono do acesso para fora com poucas tentativas.
const JANELA_MS = 60 * 60 * 1000;
const LIMITE_IP_USUARIO = 10;
const LIMITE_USUARIO = 40;
const falhas = new Map(); // chave -> { n, expira }

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normUsuario = (u) => String(u || "").toLowerCase().replace(/[.\-\s]/g, "");

function chaves({ username, ip }) {
  const u = hash(normUsuario(username));
  return [
    { k: `iu:${hash(`${ip || "-"}|${normUsuario(username)}`)}`, limite: LIMITE_IP_USUARIO },
    { k: `u:${u}`, limite: LIMITE_USUARIO },
  ];
}

function limpar(agora) {
  if (falhas.size < 5000) return;
  for (const [k, v] of falhas) if (v.expira <= agora) falhas.delete(k);
}

function bloqueado(ctx, agora = Date.now()) {
  return chaves(ctx).some(({ k, limite }) => {
    const v = falhas.get(k);
    return v && v.expira > agora && v.n >= limite;
  });
}

function registrarFalha(ctx, agora = Date.now()) {
  limpar(agora);
  for (const { k } of chaves(ctx)) {
    const v = falhas.get(k);
    if (v && v.expira > agora) v.n += 1;
    else falhas.set(k, { n: 1, expira: agora + JANELA_MS });
  }
}

function limparUsuario(ctx) {
  for (const { k } of chaves(ctx).slice(0, 1)) falhas.delete(k); // login certo zera a trava ip+usuario
}

function _resetar() { falhas.clear(); }

module.exports = { bloqueado, registrarFalha, limparUsuario, LIMITE_IP_USUARIO, LIMITE_USUARIO, _resetar };
