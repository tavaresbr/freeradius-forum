/**
 * Mascara um nome mantendo as 2 primeiras letras de cada palavra com mais de 2 letras.
 * "João da Silva" -> "Jo** da Si***". Palavras de ate 2 letras (da, de, do) ficam intactas.
 * @param {string} nome
 * @returns {string}
 */
function mascararNome(nome) {
  return String(nome || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => {
      const letras = Array.from(p);
      if (letras.length <= 2) return p;
      return letras.slice(0, 2).join("") + "*".repeat(letras.length - 2);
    })
    .join(" ");
}

module.exports = { mascararNome };
