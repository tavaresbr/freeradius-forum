// Itens que cada plano SaaS mostra no card do site (saas_planos.exibir_site, JSON de chaves).
// Sem a coluna/valor (NULL) vale o padrao: recursos incluidos + teste (so plano pago).
export const ITENS_SITE = [
  ["todos_recursos", "Todos os recursos incluídos"],
  ["teste", "Teste grátis (dias de teste)"],
  ["whatsapp", "WhatsApp"],
  ["campanhas", "Campanhas"],
  ["exportacao", "Exportação da base"],
  ["dominio", "Domínio próprio"],
  ["portais", "Limite de portais"],
];

const INCLUI = { whatsapp: "inclui_whatsapp", campanhas: "inclui_campanhas", exportacao: "inclui_exportacao", dominio: "inclui_dominio" };

export function itensPadrao(p) {
  const itens = Object.keys(INCLUI).filter((k) => Number(p[INCLUI[k]]) === 1);
  if (Number(p.gratis) !== 1) itens.push("teste");
  return itens;
}

export function itensDoPlano(p) {
  if (Array.isArray(p.exibir_site)) return p.exibir_site;
  if (typeof p.exibir_site === "string" && p.exibir_site) {
    try { const v = JSON.parse(p.exibir_site); if (Array.isArray(v)) return v; } catch { /* usa o padrao */ }
  }
  return itensPadrao(p);
}
