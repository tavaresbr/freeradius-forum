// Relatorio de vouchers usados: formatacao e HTML para impressao. Tudo que vem do servidor e' escapado.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtDia = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "-");
export const fmtDataHora = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "-");

/** 3600 -> "1h00", 1800 -> "0h30", null -> "-" */
export function fmtDuracao(seg) {
  if (seg === null || seg === undefined) return "-";
  const s = Math.max(0, Number(seg) || 0);
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export function htmlRelatorio({ rel, linhas, filtros }) {
  const r = rel.resumo;
  const tabela = (cab, corpo) => `<table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table>`;
  const detalhe = linhas.map((v) => `<tr><td class="m">${esc(v.codigo)}</td><td>${esc(v.plano_nome)}</td><td>${esc(v.equipamento_nome || "Qualquer")}</td><td>${esc(v.usado_equipamento || "")}</td><td>${esc(v.lote || "")}</td><td>${esc(fmtDataHora(v.usado_em))}</td><td class="m">${esc(v.usado_mac || "")}</td><td>${esc(fmtDuracao(v.consumido_segundos))} / ${esc(fmtDuracao(v.total_segundos))}</td></tr>`).join("");
  const porDia = rel.por_dia.map((d) => `<tr><td>${esc(fmtDia(d.dia))}</td><td>${esc(d.n)}</td></tr>`).join("");
  const porEquip = rel.por_equipamento.map((e) => `<tr><td>${esc(e.equipamento_nome || "Qualquer (legado)")}</td><td>${esc(e.usados_periodo)}</td><td>${esc(e.disponiveis)}</td><td>${esc(e.cancelados)}</td></tr>`).join("");
  const porLote = rel.por_lote.map((l) => `<tr><td>${esc(l.lote || "Sem lote")}</td><td>${esc(l.usados_periodo)}</td><td>${esc(l.disponiveis)}</td><td>${esc(l.cancelados)}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vouchers usados</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 10pt; }
    h1 { font-size: 15pt; margin: 0 0 2mm; } h2 { font-size: 11pt; margin: 6mm 0 2mm; }
    .sub { color: #555; margin-bottom: 3mm; } .res span { margin-right: 8mm; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2mm; }
    th, td { border: 1px solid #999; padding: 1mm 2mm; text-align: left; font-size: 9pt; } th { background: #eee; }
    .m { font-family: "Courier New", monospace; } tr { break-inside: avoid; }
  </style></head><body>
  <h1>Relatório de vouchers usados</h1>
  <div class="sub">Período: ${esc(fmtDia(filtros.de))} a ${esc(fmtDia(filtros.ate))}${filtros.equipamentoNome ? ` · Equipamento: ${esc(filtros.equipamentoNome)}` : ""}${filtros.lote ? ` · Lote: ${esc(filtros.lote === "__sem__" ? "Sem lote" : filtros.lote)}` : ""}</div>
  <div class="res"><span><b>${esc(r.usados_periodo)}</b> usados no período</span><span><b>${esc(r.disponiveis)}</b> disponíveis</span><span><b>${esc(r.cancelados)}</b> cancelados</span><span>Taxa de uso: <b>${esc(r.taxa_uso)}%</b></span></div>
  <h2>Usados por dia</h2>${tabela(["Dia", "Usados"], porDia)}
  <h2>Por equipamento</h2>${tabela(["Equipamento", "Usados no período", "Disponíveis", "Cancelados"], porEquip)}
  <h2>Por lote</h2>${tabela(["Lote", "Usados no período", "Disponíveis", "Cancelados"], porLote)}
  <h2>Vouchers usados (${esc(linhas.length)})</h2>${tabela(["Código", "Plano", "Equipamento", "Usado no equip.", "Lote", "Usado em", "MAC", "Consumido / plano"], detalhe)}
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
}
