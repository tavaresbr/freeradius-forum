// Rotas publicas recebem corpos "planos" (strings/numeros/booleanos). Um objeto ou array no lugar
// de uma string e' tentativa de type-confusion em consultas SQL (ex.: {"username":1}), entao e' recusado.
module.exports = function somentePrimitivos(req, res, next) {
  const b = req.body;
  if (b && typeof b === "object") {
    for (const v of Object.values(b)) {
      if (v !== null && typeof v === "object") {
        return res.status(400).json({ error: "Requisição inválida" });
      }
    }
  }
  next();
};
