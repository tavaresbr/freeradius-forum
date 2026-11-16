// ZIP minimo (metodo "stored", sem compressao) gerado no navegador, sem biblioteca.
// arquivos: [{ nome, conteudo }] (conteudo = string UTF-8). Devolve um Blob application/zip.

let TABELA_CRC = null;
function crc32(bytes) {
  if (!TABELA_CRC) {
    TABELA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABELA_CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Data/hora no formato MS-DOS (campo obrigatorio do ZIP)
function dataDos(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const data = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, data };
}

export function criarZipBytes(arquivos, agora = new Date()) {
  const enc = new TextEncoder();
  const { hora, data } = dataDos(agora);
  const partes = [];
  const central = [];
  let deslocamento = 0;

  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const dados = enc.encode(a.conteudo);
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versao minima
    local.setUint16(6, 0x0800, true); // nome em UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, hora, true);
    local.setUint16(12, data, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, data, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(c.buffer), nome);

    deslocamento += 30 + nome.length + dados.length;
  }

  const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);

  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const total = todas.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of todas) { saida.set(p, pos); pos += p.length; }
  return saida;
}

export function criarZip(arquivos) {
  return new Blob([criarZipBytes(arquivos)], { type: "application/zip" });
}
