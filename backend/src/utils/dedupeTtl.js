// "Ja vi essa chave nos ultimos N ms?" em memoria do processo (zera no restart do PM2).
// Usado para nao contar a mesma visualizacao/clique de campanha duas vezes (reload, duplo toque).
function criarDedupe({ ttlMs = 30 * 60 * 1000, maxChaves = 20000, agora = Date.now } = {}) {
  const vistos = new Map(); // chave -> expira em (ms)

  function limpar(t) {
    for (const [k, exp] of vistos) if (exp <= t) vistos.delete(k);
    // Teto de seguranca: se ainda estiver grande (rajada de chaves unicas), descarta as mais antigas
    if (vistos.size > maxChaves) {
      const excesso = vistos.size - maxChaves;
      let i = 0;
      for (const k of vistos.keys()) { vistos.delete(k); if (++i >= excesso) break; }
    }
  }

  // true = repetida (nao conta); false = primeira vez na janela (registra e conta)
  function jaVisto(chave) {
    const t = agora();
    const exp = vistos.get(chave);
    if (exp && exp > t) return true;
    if (vistos.size >= maxChaves) limpar(t);
    vistos.set(chave, t + ttlMs);
    return false;
  }

  return { jaVisto, tamanho: () => vistos.size };
}

module.exports = { criarDedupe };
