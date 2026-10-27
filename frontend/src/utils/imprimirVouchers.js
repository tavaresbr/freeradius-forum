// Impressao de vouchers em cartoes (8 por folha A4). Tudo que vem do servidor e' escapado.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function duracaoTexto(min) {
  const m = Number(min);
  if (!m) return "";
  if (m % 1440 === 0) return `${m / 1440} dia${m / 1440 > 1 ? "s" : ""}`;
  if (m >= 60 && m % 60 === 0) return `${m / 60} hora${m / 60 > 1 ? "s" : ""}`;
  return `${m} minutos`;
}

const dia = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

export function htmlCartoes(vouchers, { rede = "" } = {}) {
  const cartoes = vouchers.map((v) => `
    <div class="cartao">
      ${rede ? `<div class="rede">${esc(rede)}</div>` : ""}
      <div class="titulo">Voucher Wi-Fi</div>
      <div class="codigo">${esc(v.codigo)}</div>
      <div class="info">${esc(v.plano_nome || "")}${v.plano_minutos ? ` · ${esc(duracaoTexto(v.plano_minutos))}` : ""}</div>
      ${v.valido_ate ? `<div class="info">Válido até ${esc(dia(v.valido_ate))}</div>` : ""}
      <div class="passo">Conecte-se ao Wi-Fi e digite o código no portal.</div>
    </div>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vouchers</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; }
    .folha { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
    .cartao { border: 1px dashed #666; border-radius: 3mm; height: 62mm; padding: 4mm; text-align: center;
      display: flex; flex-direction: column; justify-content: center; gap: 2mm; break-inside: avoid; }
    .rede { font-size: 11pt; font-weight: bold; }
    .titulo { font-size: 9pt; text-transform: uppercase; letter-spacing: 1px; color: #555; }
    .codigo { font-family: "Courier New", monospace; font-size: 22pt; font-weight: bold; letter-spacing: 3px; }
    .info { font-size: 10pt; }
    .passo { font-size: 8pt; color: #555; }
  </style></head><body><div class="folha">${cartoes}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
}

/** Abre a janela JA no clique (antes de qualquer fetch), senao o navegador bloqueia o pop-up. */
export function abrirJanelaImpressao() {
  return window.open("", "_blank");
}

export function escreverCartoes(w, vouchers, opcoes) {
  w.document.open();
  w.document.write(htmlCartoes(vouchers, opcoes));
  w.document.close();
}
