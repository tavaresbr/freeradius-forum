import qrcode from "qrcode-generator";

// Impressao de vouchers em cartoes (30 por folha A4). Tudo que vem do servidor e' escapado.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function duracaoTexto(min) {
  const m = Number(min);
  if (!m) return "";
  if (m % 1440 === 0) return `${m / 1440} dia${m / 1440 > 1 ? "s" : ""}`;
  if (m >= 60 && m % 60 === 0) return `${m / 60} hora${m / 60 > 1 ? "s" : ""}`;
  return `${m} minutos`;
}

const dia = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

/** URL que o QR abre: pagina do voucher com o codigo preenchido (o MAC so chega pelo redirect do hotspot). */
export function urlVoucher(origem, empresaId, mikrotikId, codigo) {
  const qs = new URLSearchParams({ empresa_id: empresaId, mikrotik_id: mikrotikId, codigo });
  return `${origem}/voucher?${qs}`;
}

function svgQr(texto) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

export const CARTOES_POR_FOLHA = 30; // 3 colunas x 10 linhas em A4

export function htmlCartoes(vouchers, { rede = "", origem = "", empresaId = "", equipamentoPadrao = "" } = {}) {
  const cartoes = vouchers.map((v) => {
    const mk = v.equipamento_id || equipamentoPadrao;
    const qr = origem && empresaId && mk ? svgQr(urlVoucher(origem, empresaId, mk, v.codigo)) : "";
    return `
    <div class="cartao">
      ${qr ? `<div class="qr">${qr}</div>` : ""}
      <div class="texto">
        ${rede ? `<div class="rede">${esc(rede)}</div>` : ""}
        <div class="codigo">${esc(v.codigo)}</div>
        <div class="info">${esc(v.plano_nome || "")}${v.plano_minutos ? ` · ${esc(duracaoTexto(v.plano_minutos))}` : ""}${v.valido_ate ? ` · até ${esc(dia(v.valido_ate))}` : ""}</div>
        <div class="passo">${qr ? "Leia o QR code ou digite o código no portal do Wi-Fi" : "Digite o código no portal do Wi-Fi"}</div>
      </div>
    </div>`;
  });
  // Uma .folha por pagina (30 cartoes): a quebra nao depende de o navegador fragmentar o grid.
  const folhas = [];
  for (let i = 0; i < cartoes.length; i += CARTOES_POR_FOLHA) {
    folhas.push(`<div class="folha">${cartoes.slice(i, i + CARTOES_POR_FOLHA).join("")}</div>`);
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vouchers</title><style>
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; }
    .folha { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 26mm; gap: 2mm; page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }
    .cartao { border: 1px dashed #666; border-radius: 2mm; padding: 1.5mm 2mm; overflow: hidden;
      display: flex; align-items: center; justify-content: center; gap: 2mm; text-align: center; }
    .qr svg { width: 19mm; height: 19mm; display: block; }
    .texto { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 0.6mm; }
    .rede { font-size: 7.5pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .codigo { font-family: "Courier New", monospace; font-size: 13pt; font-weight: bold; letter-spacing: 1.5px; }
    .info { font-size: 7pt; }
    .passo { font-size: 5.5pt; color: #555; }
  </style></head><body>${folhas.join("")}
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
