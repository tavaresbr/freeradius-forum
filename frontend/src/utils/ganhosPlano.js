import { ITENS_SITE, itensDoPlano } from "./itensSitePlano.js";

// O que um plano ganha em relacao ao anterior da lista (ordenada do menor ao maior), para destacar o motivo de subir.
// Devolve { equipamentos, admins, novos }: equipamentos/admins = numero a mais, "ilimitados" (anterior limitado e este nao)
// ou null (sem ganho); novos = chaves de itensSite que o anterior nao tinha (exceto o teste gratis).
const maisLimite = (atual, anterior) => {
  if (atual == null) return anterior == null ? null : "ilimitados";
  if (anterior == null) return null;
  const d = Number(atual) - Number(anterior);
  return d > 0 ? d : null;
};

export function ganhosDoPlano(p, anterior) {
  if (!p || !anterior) return null;
  const antes = new Set(itensDoPlano(anterior));
  const novos = itensDoPlano(p).filter((k) => k !== "teste" && ITENS_SITE.some(([x]) => x === k) && !antes.has(k));
  return { equipamentos: maisLimite(p.max_equipamentos, anterior.max_equipamentos), admins: maisLimite(p.max_admins, anterior.max_admins), novos };
}
